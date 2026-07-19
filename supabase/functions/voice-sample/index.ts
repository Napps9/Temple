// Returns a public URL for a short sample clip of one of the agent voices,
// synthesising and caching it on first request. The clip is the same line
// for every voice so owners compare voices, not scripts.
//
// Signed-in caller (any authenticated user — the clips carry no tenant
// data; the picker is behind the staff gate anyway). Voice ids are
// allow-listed, so this cannot be used as a general TTS proxy.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (absent -> url: null and
// the picker simply shows no play buttons)

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

// Mirrors AGENT_VOICES in src/lib/agent-voices.ts.
const VOICE_IDS = new Set([
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-IE-EmilyNeural',
  'en-IE-ConnorNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-AU-NatashaNeural',
  'en-CA-LiamNeural',
  'en-NZ-MollyNeural',
  'en-ZA-LukeNeural',
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

  const AZURE_KEY = Deno.env.get('AZURE_SPEECH_KEY');
  const AZURE_REGION = Deno.env.get('AZURE_SPEECH_REGION');
  if (!AZURE_KEY || !AZURE_REGION) return json({ url: null, reason: 'not_configured' });

  const locale = voiceId.split('-').slice(0, 2).join('-');
  const ssml =
    `<speak version='1.0' xml:lang='${locale}'>` +
    `<voice name='${voiceId}'>${SAMPLE_LINE}</voice></speak>`;

  const res = await fetch(
    `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3',
        'User-Agent': 'temple-voice-sample',
      },
      body: ssml,
    },
  );
  if (!res.ok) {
    console.error('azure tts failed', res.status, (await res.text()).slice(0, 200));
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
