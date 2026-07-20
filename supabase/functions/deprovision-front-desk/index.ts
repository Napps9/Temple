// Tear down a gym's provisioned AI front desk (design:
// docs/ai-front-desk-provisioning.md) — on churn or an owner turning it off.
// Best-effort deletes the Vapi phone-number, the Vapi assistant, and releases
// the Twilio number, then nulls the provisioning columns.
//
// Owner/admin caller (re-checks effective_can(can_review_ai_calls)); works under
// the service role. Each external delete is best-effort: a provider that already
// dropped the resource (404) must not block clearing our own rows.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   VAPI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

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
  const { data: row } = await service
    .from('gym_agent_settings')
    .select('twilio_number_sid, vapi_assistant_id, vapi_phone_number_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!row) return json({ released: true, already: true });

  const VAPI_KEY = Deno.env.get('VAPI_API_KEY');
  const TW_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TW_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  // Best-effort — a 404 (already gone) is fine; log and move on so our rows
  // always end up cleared.
  const tryDelete = async (label: string, fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      if (!res.ok && res.status !== 404) {
        console.error(`${label} failed`, res.status, (await res.text()).slice(0, 200));
      }
    } catch (e) {
      console.error(`${label} unreachable`, String(e).slice(0, 120));
    }
  };

  if (VAPI_KEY && row.vapi_phone_number_id) {
    await tryDelete('vapi number delete', () =>
      fetch(`https://api.vapi.ai/phone-number/${row.vapi_phone_number_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
      }),
    );
  }
  if (VAPI_KEY && row.vapi_assistant_id) {
    await tryDelete('vapi assistant delete', () =>
      fetch(`https://api.vapi.ai/assistant/${row.vapi_assistant_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
      }),
    );
  }
  if (TW_SID && TW_TOKEN && row.twilio_number_sid) {
    await tryDelete('twilio release', () =>
      fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/IncomingPhoneNumbers/${row.twilio_number_sid}.json`,
        { method: 'DELETE', headers: { Authorization: `Basic ${btoa(`${TW_SID}:${TW_TOKEN}`)}` } },
      ),
    );
  }

  await service
    .from('gym_agent_settings')
    .update({
      phone_number: null,
      vapi_assistant_id: null,
      vapi_phone_number_id: null,
      twilio_number_sid: null,
      voice_enabled: false,
      enabled: false,
      provision_status: 'released',
      updated_at: new Date().toISOString(),
    })
    .eq('gym_id', gymId);

  return json({ released: true });
});
