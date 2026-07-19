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
  resolveGymByAssistant,
  resolveGymByNumber,
  sendTwilioSms,
  twiml,
  validateTwilioSignature,
  type AgentGym,
  type Conversation,
  type ToolContext,
} from '../_shared/lead-agent.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Pull the Vapi call recording into our own private bucket
// (agent-call-recordings) and register it in call_recordings. Vapi's default
// storage has no guaranteed retention, so we own the copy. Field names on the
// artifact vary across Vapi versions — probe the known shapes and no-op if the
// recording isn't present (or the gym has recording switched off).
async function captureRecording(
  // deno-lint-ignore no-explicit-any
  service: any,
  gym: AgentGym,
  conversation: Conversation,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<void> {
  if (!gym.settings.call_recording_enabled) return;
  const rec = message?.artifact?.recording ?? {};
  const url: unknown =
    rec?.mono?.combinedUrl ??
    rec?.combinedUrl ??
    rec?.mono?.url ??
    rec?.stereoUrl ??
    rec?.url ??
    message?.artifact?.recordingUrl ??
    message?.recordingUrl ??
    message?.stereoRecordingUrl ??
    null;
  if (typeof url !== 'string' || !url) return;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('recording fetch failed', res.status);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = url.split('?')[0].toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
  const contentType =
    res.headers.get('content-type') || (ext === 'wav' ? 'audio/wav' : 'audio/mpeg');
  const callId = message?.call?.id ?? crypto.randomUUID();
  const path = `${gym.id}/${conversation.id}/${callId}.${ext}`;

  const { error: upErr } = await service.storage
    .from('agent-call-recordings')
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) {
    console.error('recording upload failed', upErr.message);
    return;
  }

  const duration =
    typeof message?.durationSeconds === 'number'
      ? Math.round(message.durationSeconds)
      : typeof message?.call?.durationSeconds === 'number'
        ? Math.round(message.call.durationSeconds)
        : null;
  // 'notice_played' only when the synced greeting actually contains the
  // recording notice (recording_notice_at is stamped by sync-vapi-assistant);
  // an unsynced assistant may never have told the caller.
  const consent =
    message?.artifact?.recordingConsent === false
      ? 'withdrawn'
      : (message?.recordingConsentState ??
        (gym.settings.recording_notice_at ? 'notice_played' : 'unknown'));

  await service.from('call_recordings').insert({
    gym_id: gym.id,
    conversation_id: conversation.id,
    recording_path: path,
    duration_seconds: duration,
    consent_state: consent,
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
  // No customer number on a Vapi browser test — fall back to a synthetic id so
  // get_gym_info / capture_lead still work end-to-end.
  const callerNumber: string = message?.call?.customer?.number ?? 'web-test';
  const gymNumber: string | null =
    message?.call?.phoneNumber?.number ?? message?.phoneNumber?.number ?? null;
  const assistantId: string | null =
    message?.assistant?.id ??
    message?.call?.assistantId ??
    message?.call?.assistant?.id ??
    null;

  // Prefer the inbound number; fall back to the assistant id (per-gym) so the
  // Vapi test call works before any Twilio number is provisioned.
  let gym = gymNumber ? await resolveGymByNumber(service, gymNumber) : null;
  if (!gym && assistantId) gym = await resolveGymByAssistant(service, assistantId);
  if (!gym || !gym.settings.enabled) {
    return json({ error: 'Unknown assistant or number' }, 404);
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
          null,
          {
            secondsFromStart:
              typeof t.secondsFromStart === 'number' ? t.secondsFromStart : null,
            durationMs: typeof t.duration === 'number' ? t.duration : null,
          },
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

    // Best-effort: pull the Vapi recording into our own private bucket so
    // owners can play calls back for QC. Never fail the webhook over it.
    try {
      await captureRecording(service, gym, conversation, message);
    } catch (e) {
      console.error('captureRecording failed', e);
    }

    return json({ ok: true });
  }

  return json({ ok: true });
});
