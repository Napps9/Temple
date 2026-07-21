// Push the gym's AI front-desk config to its Vapi assistant so the phone
// channel matches SMS: system prompt (owner notes + coaching corrections +
// live plan/schedule snapshot), the full tool set (including the close tools
// start_onboarding and enroll_member, which the hand-configured assistants
// never had), the owner's voice pick, and a greeting that discloses the AI
// and — when recording is on — the recording notice.
//
// Signed-in owner/admin caller — re-checks effective_can(can_review_ai_calls)
// as the caller (same gate as generate-agent-prompt), then works under the
// service role. The app calls this after every voice/notes/recording/coaching
// save; it is best-effort from the caller's point of view (a Vapi outage must
// not fail the underlying save).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   VAPI_API_KEY, VAPI_WEBHOOK_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import {
  buildSystemPrompt,
  fetchCoachingText,
  fetchGymSnapshot,
  resolveGymById,
  VOICE_TOOLS,
} from '../_shared/lead-agent.ts';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  let body: { gym_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  if (!gymId) return json({ error: 'gym_id is required' }, 400);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_review_ai_calls',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const gym = await resolveGymById(service, gymId);
  if (!gym) return json({ synced: false, reason: 'agent_not_set_up' });
  const assistantId = gym.settings.vapi_assistant_id;
  if (!assistantId) return json({ synced: false, reason: 'no_assistant' });

  const VAPI_KEY = Deno.env.get('VAPI_API_KEY');
  const VAPI_SECRET = Deno.env.get('VAPI_WEBHOOK_SECRET');
  if (!VAPI_KEY || !VAPI_SECRET) return json({ synced: false, reason: 'vapi_not_configured' });

  const { data: voiceRow } = await service
    .from('gym_agent_settings')
    .select('voice_provider, voice_id')
    .eq('gym_id', gymId)
    .maybeSingle();

  const [snapshot, coaching] = await Promise.all([
    fetchGymSnapshot(service, gym),
    fetchCoachingText(service, gymId),
  ]);
  const system = buildSystemPrompt(gym, snapshot, 'voice', coaching);

  const toolServerUrl = `${SUPABASE_URL}/functions/v1/lead-agent-voice/tool-calls`;
  const tools = VOICE_TOOLS.map((t) => ({
    type: 'function',
    async: false,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
    server: { url: toolServerUrl, secret: VAPI_SECRET },
  }));

  // Per-tool `server` above only covers tool-calls. Without an
  // assistant-level server too, Vapi has nowhere to send end-of-call-report
  // — so the transcript, recording pull, and "Call ended" marker never
  // land, on every channel (phone and the browser test widget alike).
  // lead-agent-voice routes this exact path to its /end-of-call handler.
  const endOfCallServerUrl = `${SUPABASE_URL}/functions/v1/lead-agent-voice/end-of-call`;

  const recording = gym.settings.call_recording_enabled;
  const firstMessage =
    `Thanks for calling ${gym.name}! I'm the gym's AI assistant.` +
    (recording ? ' Just so you know, this call is recorded.' : '') +
    ' How can I help?';

  const vapiHeaders = {
    Authorization: `Bearer ${VAPI_KEY}`,
    'content-type': 'application/json',
  };

  // GET first: PATCH replaces the whole model object, and the LLM
  // provider/model/temperature stay whatever the assistant was created with.
  let existingModel: Record<string, unknown> = {};
  try {
    const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: vapiHeaders,
    });
    if (res.ok) {
      const a = await res.json();
      if (a?.model && typeof a.model === 'object') existingModel = a.model;
    } else {
      return json({ synced: false, reason: `vapi_get_${res.status}` });
    }
  } catch (e) {
    return json({ synced: false, reason: `vapi_unreachable: ${String(e).slice(0, 120)}` });
  }

  const model: Record<string, unknown> = {
    provider: existingModel.provider ?? 'openai',
    model: existingModel.model ?? 'gpt-4o',
    messages: [{ role: 'system', content: system }],
    tools,
  };
  if (typeof existingModel.temperature === 'number') {
    model.temperature = existingModel.temperature;
  }

  const patch: Record<string, unknown> = {
    model,
    firstMessage,
    server: { url: endOfCallServerUrl, secret: VAPI_SECRET },
  };
  if (voiceRow?.voice_provider && voiceRow?.voice_id) {
    patch.voice = { provider: voiceRow.voice_provider, voiceId: voiceRow.voice_id };
  }

  try {
    const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: vapiHeaders,
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error('vapi patch failed', res.status, detail);
      return json({ synced: false, reason: `vapi_patch_${res.status}` });
    }
  } catch (e) {
    return json({ synced: false, reason: `vapi_unreachable: ${String(e).slice(0, 120)}` });
  }

  await service
    .from('gym_agent_settings')
    .update({ recording_notice_at: recording ? new Date().toISOString() : null })
    .eq('gym_id', gymId);

  return json({ synced: true });
});
