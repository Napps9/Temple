// AI front desk — voice-channel webhooks. Three paths, all no-JWT:
//
//   /tool-calls    Vapi's model drives the call and hits this for data and
//                  actions (same shared tools as SMS). Guarded by the
//                  x-vapi-secret header.
//   /end-of-call   Vapi's end-of-call-report: persist the transcript into
//                  the voice conversation so staff see calls next to texts.
//                  Same guard.
//   /missed-call   Twilio voice webhook for gyms without voice enabled:
//                  answer with a short "we'll text you" message, hang up,
//                  then open the SMS thread. Guarded by the Twilio
//                  signature like lead-agent-sms.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_WEBHOOK_SECRET
// Optional: APP_ORIGIN, LEAD_AGENT_VOICE_URL (signed-URL override)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import {
  appendMessage,
  executeTool,
  getOrCreateConversation,
  resolveGymByNumber,
  sendTwilioSms,
  twiml,
  validateTwilioSignature,
  type ToolContext,
} from '../_shared/lead-agent.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const VAPI_SECRET = Deno.env.get('VAPI_WEBHOOK_SECRET');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return new Response('Function is not configured', { status: 500 });
  }

  const path = new URL(req.url).pathname;
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // --- Twilio voice webhook: gym has no live voice agent -----------------
  if (path.endsWith('/missed-call')) {
    if (!TWILIO_SID || !TWILIO_TOKEN) return twiml('<Hangup/>');
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);
    const url =
      Deno.env.get('LEAD_AGENT_VOICE_URL') ??
      `${SUPABASE_URL}/functions/v1/lead-agent-voice/missed-call`;
    const valid = await validateTwilioSignature(
      TWILIO_TOKEN,
      url,
      params,
      req.headers.get('X-Twilio-Signature'),
    );
    if (!valid) return new Response('Bad signature', { status: 403 });

    const from = params.From;
    const to = params.To;
    const gym = to ? await resolveGymByNumber(service, to) : null;
    if (!gym || !gym.settings.enabled || !from) return twiml('<Hangup/>');

    EdgeRuntime.waitUntil(
      (async () => {
        const opener = `Sorry we missed your call! I'm ${gym.name}'s assistant — text me here and I can help with classes, prices and joining.`;
        const sent = await sendTwilioSms(
          TWILIO_SID,
          TWILIO_TOKEN,
          gym.settings.phone_number,
          from,
          opener,
        );
        if (sent.sid) {
          const conversation = await getOrCreateConversation(service, gym.id, from, 'sms');
          await appendMessage(service, conversation, 'agent', opener, sent.sid);
        }
      })().catch((e) => console.error('missed-call opener failed', e)),
    );

    return twiml(
      `<Say>Sorry we missed your call. We are texting you right now so you can reach us there.</Say><Hangup/>`,
    );
  }

  // --- Vapi paths --------------------------------------------------------
  if (!VAPI_SECRET || req.headers.get('x-vapi-secret') !== VAPI_SECRET) {
    return json({ error: 'Not authorised' }, 403);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const message = body?.message ?? {};
  const callerNumber: string | null = message?.call?.customer?.number ?? null;
  const gymNumber: string | null =
    message?.call?.phoneNumber?.number ?? message?.phoneNumber?.number ?? null;

  const gym = gymNumber ? await resolveGymByNumber(service, gymNumber) : null;
  if (!gym || !gym.settings.enabled || !callerNumber) {
    return json({ error: 'Unknown number' }, 404);
  }

  if (path.endsWith('/tool-calls') && message?.type === 'tool-calls') {
    const conversation = await getOrCreateConversation(
      service,
      gym.id,
      callerNumber,
      'voice',
    );
    const ctx: ToolContext = {
      service,
      gym,
      conversation,
      channel: 'voice',
      appOrigin: (Deno.env.get('APP_ORIGIN') ?? 'https://app.jointemple.io').replace(
        /\/+$/,
        '',
      ),
      twilio:
        TWILIO_SID && TWILIO_TOKEN
          ? { accountSid: TWILIO_SID, authToken: TWILIO_TOKEN }
          : null,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    };

    // deno-lint-ignore no-explicit-any
    const calls: any[] = message?.toolCallList ?? message?.toolCalls ?? [];
    const results = [];
    for (const call of calls) {
      const name: string = call?.function?.name ?? call?.name ?? '';
      let args = call?.function?.arguments ?? call?.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      let result: string;
      try {
        result = await executeTool(ctx, name, args);
      } catch (e) {
        result = `Tool failed: ${String(e).slice(0, 200)}`;
      }
      results.push({ toolCallId: call?.id ?? call?.toolCallId ?? '', result });
    }
    return json({ results });
  }

  if (path.endsWith('/end-of-call') && message?.type === 'end-of-call-report') {
    const conversation = await getOrCreateConversation(
      service,
      gym.id,
      callerNumber,
      'voice',
    );
    // deno-lint-ignore no-explicit-any
    const turns: any[] = message?.artifact?.messages ?? [];
    const spoken = turns.filter(
      (t) =>
        (t?.role === 'user' || t?.role === 'bot' || t?.role === 'assistant') &&
        t?.message,
    );
    if (spoken.length > 0) {
      for (const t of spoken) {
        await appendMessage(
          service,
          conversation,
          t.role === 'user' ? 'lead' : 'agent',
          String(t.message),
        );
      }
    } else if (message?.transcript) {
      await appendMessage(
        service,
        conversation,
        'system',
        `Call transcript:\n${String(message.transcript)}`,
      );
    }
    return json({ ok: true });
  }

  return json({ ok: true });
});
