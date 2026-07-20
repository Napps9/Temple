// Returns a public URL for a short sample clip of one of the agent voices,
// synthesising and caching it on first request. The clip is the same line
// for every voice so owners compare voices, not scripts.
//
// Signed-in caller (any authenticated user — the clips carry no tenant
// data; the picker is behind the staff gate anyway). Voice ids are
// allow-listed, so this cannot be used as a general TTS proxy.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional: ELEVENLABS_API_KEY (absent -> url: null and the picker simply
// shows no play buttons). The live call voice runs through Vapi's bundled
// ElevenLabs access and needs no key here; this key is only for in-app previews.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

// Mirrors AGENT_VOICES in src/lib/agent-voices.ts (ElevenLabs voice ids).
const VOICE_IDS = new Set([
  'JBFqnCBsd6RMkjVDRZzb',
  'Xb7hH8MSUJpSbSDYk0k2',
  'pFZP5JQG7iQjIQuC4Bku',
  'onwK4e9ZLuTAKqWW03F9',
  '21m00Tcm4TlvDq8ikWAM',
  'nPczCjzI2devNBz1zQrb',
  'IKne3meq5aSn9XLyUdCD',
]);

const SAMPLE_LINE =
  "Hi, thanks for calling! I can help with classes, prices and joining. What can I do for you?";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: { voice_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const voiceId = body.voice_id ?? '';
  if (!VOICE_IDS.has(voiceId)) return json({ error: 'Unknown voice' }, 400);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not authorised' }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const path = `${voiceId}.mp3`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/agent-voice-samples/${path}`;

  const { data: existing } = await service.storage
    .from('agent-voice-samples')
    .list('', { search: path });
  if ((existing ?? []).some((f: { name: string }) => f.name === path)) {
    return json({ url: publicUrl });
  }

  const EL_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  if (!EL_KEY) return json({ url: null, reason: 'not_configured' });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': EL_KEY,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text: SAMPLE_LINE, model_id: 'eleven_turbo_v2_5' }),
  });
  if (!res.ok) {
    console.error('elevenlabs tts failed', res.status, (await res.text()).slice(0, 200));
    return json({ url: null, reason: 'synthesis_failed' });
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  const { error: upErr } = await service.storage
    .from('agent-voice-samples')
    .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });
  if (upErr) {
    console.error('sample upload failed', upErr.message);
    return json({ url: null, reason: 'upload_failed' });
  }

  return json({ url: publicUrl });
});
