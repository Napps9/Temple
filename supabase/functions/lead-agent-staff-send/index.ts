// AI front desk — staff take-over. Signed-in staff pause the agent on a
// conversation, text the lead from the gym's number, or hand the thread
// back to the AI.
//
// Authorisation: the caller-scoped client reads the conversation through
// RLS — a visible row proves user_can_assign_plan for that gym (the same
// predicate that gates every leads surface). Writes then go through the
// service client, because clients have no write policies on agent tables.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (for action 'send')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { appendMessage, sendTwilioSms } from '../_shared/lead-agent.ts';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: { conversation_id?: string; action?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const conversationId = body.conversation_id;
  const action = body.action;
  if (!conversationId || !action) {
    return json({ error: 'conversation_id and action are required' }, 400);
  }
  if (!['take_over', 'send', 'reopen'].includes(action)) {
    return json({ error: 'Unknown action' }, 400);
  }

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: visible } = await caller
    .from('agent_conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!visible) return json({ error: 'Not authorised' }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: conversation } = await service
    .from('agent_conversations')
    .select('id, gym_id, phone, status')
    .eq('id', conversationId)
    .single();
  if (!conversation) return json({ error: 'Conversation not found' }, 404);

  // A closed thread means the person replied STOP — it never reopens and
  // never receives another message from us.
  if (conversation.status === 'closed') {
    return json({ error: 'This person opted out — the thread is closed' }, 409);
  }

  if (action === 'take_over') {
    await service
      .from('agent_conversations')
      .update({ status: 'handed_off' })
      .eq('id', conversationId);
    return json({ ok: true, status: 'handed_off' });
  }

  if (action === 'reopen') {
    await service
      .from('agent_conversations')
      .update({ status: 'active' })
      .eq('id', conversationId);
    return json({ ok: true, status: 'active' });
  }

  const text = (body.body ?? '').trim();
  if (!text) return json({ error: 'Message body is required' }, 400);

  const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    return json({ error: 'SMS is not configured' }, 500);
  }
  const { data: settings } = await service
    .from('gym_agent_settings')
    .select('phone_number')
    .eq('gym_id', conversation.gym_id)
    .maybeSingle();
  if (!settings?.phone_number) {
    return json({ error: 'This gym has no agent phone number' }, 409);
  }

  const sent = await sendTwilioSms(
    TWILIO_SID,
    TWILIO_TOKEN,
    settings.phone_number,
    conversation.phone,
    text,
  );
  if (!sent.sid) return json({ error: sent.error ?? 'Send failed' }, 502);

  await appendMessage(service, conversation, 'staff', text, sent.sid);
  // A human replying implicitly takes the thread over — the agent must not
  // talk over them on the lead's next message.
  if (conversation.status === 'active') {
    await service
      .from('agent_conversations')
      .update({ status: 'handed_off' })
      .eq('id', conversationId);
  }
  return json({ ok: true, status: 'handed_off' });
});
