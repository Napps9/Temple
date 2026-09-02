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
//   TWILIO_UK_BUNDLE_SID, TWILIO_UK_ADDRESS_SID,
//   TWILIO_UK_MOBILE_BUNDLE_SID (optional — a second bundle approved for
//   mobile numbers; without one, only voice-only local numbers can be bought)

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
  const TW_MOBILE_BUNDLE = Deno.env.get('TWILIO_UK_MOBILE_BUNDLE_SID');
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

  // `detail` is the provider's own words, shown to the owner. Without it a
  // Twilio 400 and a Vapi 400 both read as "something went wrong", and the
  // only copy of the reason is a function log the owner can't see.
  const fail = async (reason: string, detail: string | null = null) => {
    console.error('provision failed', gymId, reason, detail ?? '');
    await service
      .from('gym_agent_settings')
      .update({ provision_status: 'failed', updated_at: new Date().toISOString() })
      .eq('gym_id', gymId);
    return json({ provisioned: false, reason, detail });
  };
  const providerMessage = (text: string): string => {
    try {
      const parsed = JSON.parse(text);
      const msg = parsed?.message ?? parsed?.error?.message ?? parsed?.error;
      if (typeof msg === 'string') return msg.slice(0, 200);
      if (Array.isArray(parsed?.message)) return parsed.message.join('; ').slice(0, 200);
    } catch {
      // not JSON
    }
    return text.slice(0, 200);
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
    // A UK *local* number cannot carry SMS, so the gym wants a mobile that
    // does both. But a Twilio regulatory bundle is approved against one
    // regulation — country + number type + end-user type — and a bundle
    // approved for local numbers cannot buy a mobile: Twilio refuses the
    // purchase with a 400 (21649, "requires a bundle valid for the phone
    // number"). Which number types Temple can buy is therefore a property
    // of the bundles it holds, read from Twilio rather than assumed, and
    // the purchase walks the types in preference order — mobile, then a
    // voice-only local — trying the next when one is refused. A gym with
    // a voice number is still a working front desk, it just cannot text.
    // What was bought is recorded below rather than assumed from which
    // branch bought it.
    type Kind = 'Mobile' | 'Local';
    const bundles = new Map<Kind, string>();
    const bundleProblems: string[] = [];
    const configured: Array<{ sid: string; assumed: Kind }> = [
      ...(TW_MOBILE_BUNDLE ? [{ sid: TW_MOBILE_BUNDLE, assumed: 'Mobile' as Kind }] : []),
      { sid: TW_BUNDLE, assumed: 'Local' as Kind },
    ];
    for (const { sid, assumed } of configured) {
      if ([...bundles.values()].includes(sid)) continue;
      try {
        const bres = await fetch(
          `https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles/${sid}`,
          { headers: { Authorization: twAuth } },
        );
        if (!bres.ok) {
          // The bundle can't be inspected (a typo'd SID, a Numbers API
          // hiccup). Twilio still decides at purchase time, so keep the
          // documented assumption and let the buy below say no if it must.
          console.error('bundle lookup failed', sid, bres.status);
          if (!bundles.has(assumed)) bundles.set(assumed, sid);
          continue;
        }
        const bundle = await bres.json();
        const approved =
          bundle?.status === 'twilio-approved' || bundle?.status === 'provisionally-approved';
        if (!approved) {
          bundleProblems.push(`bundle ${sid} is ${bundle?.status ?? 'unknown'}`);
          continue;
        }
        const rres = await fetch(
          `https://numbers.twilio.com/v2/RegulatoryCompliance/Regulations/${bundle.regulation_sid}`,
          { headers: { Authorization: twAuth } },
        );
        const numberType = rres.ok ? (await rres.json())?.number_type : null;
        const kind: Kind | null =
          numberType === 'mobile'
            ? 'Mobile'
            : numberType === 'local' || numberType === 'national'
              ? 'Local'
              : numberType
                ? null
                : assumed;
        if (!kind) {
          bundleProblems.push(`bundle ${sid} covers ${numberType} numbers`);
          continue;
        }
        if (!bundles.has(kind)) bundles.set(kind, sid);
      } catch (e) {
        return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
      }
    }
    if (bundles.size === 0) {
      return await fail('bundle_not_approved', bundleProblems.join('; ') || null);
    }
    console.log('bundles', Object.fromEntries(bundles));

    const search = async (kind: Kind) => {
      const params = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '5' });
      if (kind === 'Mobile') params.set('SmsEnabled', 'true');
      const res = await fetch(`${twBase}/AvailablePhoneNumbers/GB/${kind}.json?${params}`, {
        headers: { Authorization: twAuth },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.available_phone_numbers?.[0]?.phone_number ?? null;
    };

    let bought: { sid: string; phone_number: string; capabilities?: { sms?: boolean } } | null =
      null;
    let lastReason = 'no_numbers_available';
    let lastDetail: string | null = null;
    for (const kind of ['Mobile', 'Local'] as Kind[]) {
      const bundleSid = bundles.get(kind);
      if (!bundleSid) continue;
      try {
        const candidate = await search(kind);
        if (!candidate) continue;
        const form = new URLSearchParams({
          PhoneNumber: candidate,
          BundleSid: bundleSid,
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
          const text = (await res.text()).slice(0, 300);
          console.error('twilio buy failed', kind, candidate, res.status, text);
          lastReason = `twilio_buy_${res.status}`;
          lastDetail = providerMessage(text);
          continue;
        }
        bought = await res.json();
        break;
      } catch (e) {
        return await fail(`twilio_unreachable: ${String(e).slice(0, 100)}`);
      }
    }
    if (!bought) return await fail(lastReason, lastDetail);

    number = bought.phone_number;
    // Read the capability off the number we actually bought rather than
    // off which search matched: a fallback, a Twilio change, or a
    // reserved number would all make our intent a lie, and a gym whose
    // switch says it can text but cannot is worse than one that admits it.
    const smsCapable = bought.capabilities?.sms === true;
    // Persist the SID and the number together — never one without the
    // other, or a resume can't tell "bought" from "half-bought".
    await service
      .from('gym_agent_settings')
      .update({
        twilio_number_sid: bought.sid,
        phone_number: number,
        sms_capable: smsCapable,
        updated_at: new Date().toISOString(),
      })
      .eq('gym_id', gymId);
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
        return await fail(`vapi_assistant_${res.status}`, providerMessage(await res.text()));
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
  //    Skipped on resume if already imported. Vapi's resources are singular
  //    (/assistant, /call, /phone-number); the old /phone-numbers/import
  //    route is gone and answers "Cannot POST". smsEnabled false keeps Vapi
  //    from overwriting the SmsUrl set at purchase — texts are ours, not
  //    Vapi's.
  if (!settings.vapi_phone_number_id) {
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
          smsEnabled: false,
        }),
      });
      if (!res.ok) {
        return await fail(`vapi_import_${res.status}`, providerMessage(await res.text()));
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
