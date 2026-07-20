// Self-serve AI front-desk provisioning (design: docs/ai-front-desk-provisioning.md).
//
// Owner clicks "Go live"; this buys a UK voice number under Temple's Twilio
// account (using Temple's regulatory bundle), creates the gym's Vapi assistant,
// imports the number onto it, and populates the assistant via the existing
// sync-vapi-assistant. The gym never touches Twilio or Vapi.
//
// Owner/admin caller (re-checks effective_can(can_review_ai_calls)); then works
// under the service role. Gated on the operator-set front_desk_entitled flag —
// provisioning is a billed act. Idempotent: a gym already 'live' returns its
// number; provider ids are persisted step-by-step so a mid-way failure leaves
// enough state for deprovision to clean up.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   VAPI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_UK_BUNDLE_SID, TWILIO_UK_ADDRESS_SID

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

  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_review_ai_calls',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const VAPI_KEY = Deno.env.get('VAPI_API_KEY');
  const TW_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TW_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TW_BUNDLE = Deno.env.get('TWILIO_UK_BUNDLE_SID');
  const TW_ADDRESS = Deno.env.get('TWILIO_UK_ADDRESS_SID');
  if (!VAPI_KEY || !TW_SID || !TW_TOKEN || !TW_BUNDLE || !TW_ADDRESS) {
    return json({ provisioned: false, reason: 'not_configured' });
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: row } = await service
    .from('gym_agent_settings')
    .select(
      'front_desk_entitled, provision_status, phone_number, vapi_assistant_id, twilio_number_sid, vapi_phone_number_id, gyms!gym_id(name)',
    )
    .eq('gym_id', gymId)
    .maybeSingle();

  if (!row || row.front_desk_entitled !== true) {
    return json({ provisioned: false, reason: 'not_entitled' });
  }
  if (row.provision_status === 'live' && row.phone_number) {
    return json({ provisioned: true, number: row.phone_number, already: true });
  }
  const gymName = (row.gyms as { name?: string } | null)?.name ?? 'the gym';

  const twAuth = `Basic ${btoa(`${TW_SID}:${TW_TOKEN}`)}`;
  const twBase = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}`;
  const vapiHeaders = {
    Authorization: `Bearer ${VAPI_KEY}`,
    'content-type': 'application/json',
  };

  const fail = async (reason: string, patch: Record<string, unknown> = {}) => {
    await service
      .from('gym_agent_settings')
      .update({ provision_status: 'failed', updated_at: new Date().toISOString(), ...patch })
      .eq('gym_id', gymId);
    return json({ provisioned: false, reason });
  };

  await service
    .from('gym_agent_settings')
    .update({ provision_status: 'provisioning', updated_at: new Date().toISOString() })
    .eq('gym_id', gymId);

  // 1. Find an available GB local voice number.
  let candidate: string;
  try {
    const res = await fetch(
      `${twBase}/AvailablePhoneNumbers/GB/Local.json?VoiceEnabled=true&PageSize=5`,
      { headers: { Authorization: twAuth } },
    );
    if (!res.ok) return await fail(`twilio_search_${res.status}`);
    const data = await res.json();
    candidate = data?.available_phone_numbers?.[0]?.phone_number ?? '';
    if (!candidate) return await fail('no_numbers_available');
  } catch (e) {
    return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
  }

  // 2. Buy it under Temple's regulatory bundle + emergency address. Persist the
  //    SID before anything else so a later failure is recoverable by deprovision.
  let number: string;
  try {
    const form = new URLSearchParams({
      PhoneNumber: candidate,
      BundleSid: TW_BUNDLE,
      AddressSid: TW_ADDRESS,
      FriendlyName: `Temple — ${gymName}`,
      SmsUrl: `${SUPABASE_URL}/functions/v1/lead-agent-sms`,
      SmsMethod: 'POST',
    });
    const res = await fetch(`${twBase}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: { Authorization: twAuth, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      console.error('twilio buy failed', res.status, (await res.text()).slice(0, 300));
      return await fail(`twilio_buy_${res.status}`);
    }
    const data = await res.json();
    number = data.phone_number;
    await service
      .from('gym_agent_settings')
      .update({ twilio_number_sid: data.sid, updated_at: new Date().toISOString() })
      .eq('gym_id', gymId);
  } catch (e) {
    return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
  }

  // 3. Create the gym's Vapi assistant (placeholder config; sync fills it).
  let assistantId: string;
  try {
    const res = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: vapiHeaders,
      body: JSON.stringify({
        name: `${gymName} — front desk`,
        firstMessage: 'Just a moment.',
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'system', content: 'Populated by sync-vapi-assistant.' }],
        },
      }),
    });
    if (!res.ok) {
      console.error('vapi assistant create failed', res.status, (await res.text()).slice(0, 300));
      return await fail(`vapi_assistant_${res.status}`);
    }
    assistantId = (await res.json()).id;
    await service
      .from('gym_agent_settings')
      .update({ vapi_assistant_id: assistantId, updated_at: new Date().toISOString() })
      .eq('gym_id', gymId);
  } catch (e) {
    return await fail(`vapi_unreachable: ${String(e).slice(0, 100)}`);
  }

  // 4. Import the Twilio number onto the assistant so Vapi owns inbound voice.
  //    NOTE: confirm Vapi's phone-number import field names against the live API
  //    on the first real run — Vapi has shipped both /phone-number and
  //    /phone-numbers/import variants.
  try {
    const res = await fetch('https://api.vapi.ai/phone-number', {
      method: 'POST',
      headers: vapiHeaders,
      body: JSON.stringify({
        provider: 'twilio',
        number,
        twilioAccountSid: TW_SID,
        twilioAuthToken: TW_TOKEN,
        assistantId,
        name: `${gymName} — front desk`,
      }),
    });
    if (!res.ok) {
      console.error('vapi number import failed', res.status, (await res.text()).slice(0, 300));
      return await fail(`vapi_import_${res.status}`);
    }
    const vapiNumberId = (await res.json()).id;
    await service
      .from('gym_agent_settings')
      .update({ vapi_phone_number_id: vapiNumberId, updated_at: new Date().toISOString() })
      .eq('gym_id', gymId);
  } catch (e) {
    return await fail(`vapi_unreachable: ${String(e).slice(0, 100)}`);
  }

  // 5. Populate the assistant (prompt + tools + voice) via the existing sync,
  //    with the owner's auth. Best-effort — the assistant exists either way and
  //    a later settings save re-syncs it.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/sync-vapi-assistant`, {
      method: 'POST',
      headers: { Authorization: authHeader, apikey: ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ gym_id: gymId }),
    });
  } catch (e) {
    console.error('post-provision sync failed', String(e).slice(0, 120));
  }

  // 6. Go live.
  await service
    .from('gym_agent_settings')
    .update({
      phone_number: number,
      voice_enabled: true,
      enabled: true,
      provision_status: 'live',
      provisioned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('gym_id', gymId);

  return json({ provisioned: true, number });
});
