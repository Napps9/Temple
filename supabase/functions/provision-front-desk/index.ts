// Self-serve AI front-desk provisioning (design: docs/ai-front-desk-provisioning.md).
//
// Owner clicks "Go live"; this buys a UK voice number under Temple's Twilio
// account (using Temple's regulatory bundle), creates the gym's Vapi assistant,
// imports the number onto it, and populates the assistant via the existing
// sync-vapi-assistant. The gym never touches Twilio or Vapi.
//
// Owner/admin caller (re-checks effective_can(can_review_ai_calls)); then works
// under the service role. front_desk_entitled (0163) defaults to true — every
// gym on the platform already pays a flat monthly fee, so there's no billing
// reason to gate this — but the flag stays as a manual off-switch: a row that
// exists with it explicitly set to false is still refused. Idempotent and
// resumable: a gym already 'live' returns its number; each external step is
// skipped if its provider id is already on the row, so retrying a 'failed'
// run resumes from the first incomplete step instead of buying a second
// number or assistant.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   VAPI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_UK_BUNDLE_SID, TWILIO_UK_ADDRESS_SID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { gymIsDemo } from '../_shared/demo.ts';

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

  // Buying a Twilio number and creating a Vapi assistant are both real,
  // billable, externally-visible acts — a number somebody could ring. The
  // demo gym's front desk is seeded, so there is nothing here a visitor
  // needs to press for the feature to be visible (0278).
  if (await gymIsDemo(service, gymId)) {
    return json({ error: 'This is a demo gym — Temple won’t buy it a phone number' }, 409);
  }
  const { data: row } = await service
    .from('gym_agent_settings')
    .select(
      'front_desk_entitled, provision_status, phone_number, vapi_assistant_id, twilio_number_sid, vapi_phone_number_id, gyms!gym_id(name)',
    )
    .eq('gym_id', gymId)
    .maybeSingle();
  type Row = {
    front_desk_entitled: boolean;
    provision_status: string;
    phone_number: string | null;
    vapi_assistant_id: string | null;
    twilio_number_sid: string | null;
    vapi_phone_number_id: string | null;
    gyms: { name?: string } | null;
  };
  const r = row as Row | null;

  if (r && r.front_desk_entitled === false) {
    return json({ provisioned: false, reason: 'not_entitled' });
  }
  if (r?.provision_status === 'live' && r.phone_number) {
    return json({ provisioned: true, number: r.phone_number, already: true });
  }
  const gymName = r?.gyms?.name ?? 'the gym';

  // A gym with no gym_agent_settings row yet is entitled by default (0163) —
  // normalize to an empty row so the resume logic below (every "skip if
  // already set" check) doesn't need to handle null separately from
  // "nothing set yet".
  const settings: Row = r ?? {
    front_desk_entitled: true,
    provision_status: 'none',
    phone_number: null,
    vapi_assistant_id: null,
    twilio_number_sid: null,
    vapi_phone_number_id: null,
    gyms: null,
  };

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

  // 1+2. Find and buy a GB local voice number under Temple's regulatory bundle
  //      + emergency address. Skipped on resume if a previous run already
  //      bought one — retrying a failed run must never buy a second number.
  let number: string;
  if (settings.twilio_number_sid && settings.phone_number) {
    number = settings.phone_number;
  } else if (settings.twilio_number_sid) {
    // A SID was persisted but not the number itself (shouldn't happen from
    // this function going forward — it stores both atomically — but resuming
    // safely means never re-buying just because one field is missing).
    try {
      const res = await fetch(`${twBase}/IncomingPhoneNumbers/${settings.twilio_number_sid}.json`, {
        headers: { Authorization: twAuth },
      });
      if (!res.ok) return await fail(`twilio_lookup_${res.status}`);
      number = (await res.json()).phone_number;
      await service
        .from('gym_agent_settings')
        .update({ phone_number: number, updated_at: new Date().toISOString() })
        .eq('gym_id', gymId);
    } catch (e) {
      return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
    }
  } else {
    // A UK *local* number cannot carry SMS, which is what kept texts dark
    // (the "option A, voice-first" decision). Ask for a mobile that does
    // both first, and only fall back to a local voice-only number if none
    // is available — a gym with a voice number is still a working front
    // desk, it just cannot text. What we bought is recorded below rather
    // than assumed from which branch we took.
    let candidate: string;
    try {
      const search = async (kind: 'Mobile' | 'Local', sms: boolean) => {
        const params = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '5' });
        if (sms) params.set('SmsEnabled', 'true');
        const res = await fetch(
          `${twBase}/AvailablePhoneNumbers/GB/${kind}.json?${params}`,
          { headers: { Authorization: twAuth } },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data?.available_phone_numbers?.[0]?.phone_number ?? null;
      };
      candidate = (await search('Mobile', true)) ?? (await search('Local', false)) ?? '';
      if (!candidate) return await fail('no_numbers_available');
    } catch (e) {
      return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
    }

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
      // Read the capability off the number we actually bought rather than
      // off which search matched: a fallback, a Twilio change, or a
      // reserved number would all make our intent a lie, and a gym whose
      // switch says it can text but cannot is worse than one that admits it.
      const smsCapable = data?.capabilities?.sms === true;
      // Persist the SID and the number together — never one without the
      // other, or a resume can't tell "bought" from "half-bought".
      await service
        .from('gym_agent_settings')
        .update({
          twilio_number_sid: data.sid,
          phone_number: number,
          sms_capable: smsCapable,
          updated_at: new Date().toISOString(),
        })
        .eq('gym_id', gymId);
    } catch (e) {
      return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
    }
  }

  // 3. Create the gym's Vapi assistant (placeholder config; sync fills it).
  //    Skipped on resume if one already exists.
  let assistantId: string;
  if (settings.vapi_assistant_id) {
    assistantId = settings.vapi_assistant_id;
  } else {
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
  }

  // 4. Import the Twilio number onto the assistant so Vapi owns inbound voice.
  //    Skipped on resume if already imported.
  if (!settings.vapi_phone_number_id) {
    try {
      const res = await fetch('https://api.vapi.ai/phone-numbers/import', {
        method: 'POST',
        headers: vapiHeaders,
        body: JSON.stringify({
          twilioPhoneNumber: number,
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
