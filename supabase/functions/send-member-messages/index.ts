// Drains member_outbound_messages (0271) — the general member channel.
//
// Two channels, one worker, because the difference between an email and a
// text here is the transport and nothing else: the body was frozen at
// enqueue, consent was decided at enqueue, and both go out under the same
// quiet hours.
//
// THE ROW NEVER CARRIES THE ADDRESS (0175's rule, and 0266's lesson). The
// email and the phone number are resolved here, under the service role,
// from auth.users and member_contact_details.phone_e164. A queue row that
// carried the phone would be a quieter version of the leak 0266 closed.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      RESEND_API_KEY + RESEND_FROM_EMAIL (email),
//      TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (SMS).
// Without a provider's keys that channel simulates rather than fails: the
// row is marked sent and counted as simulated, exactly as the campaign and
// automation workers do.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymMember } from '../_shared/caller.ts';
import { escapeHtml, templeEmailHtml } from '../_shared/email-layout.ts';
import { inQuietHours } from '../_shared/gym-clock.ts';
import { sendTwilioSms } from '../_shared/lead-agent.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

const MAX_ATTEMPTS = 3;

type Row = {
  id: string;
  profile_id: string;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  attempts: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');
  const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
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

  const who = await requireGymMember(req, gymId, SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!who.ok) return json({ error: who.error }, who.status);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: gym } = await service
    .from('gyms')
    .select('name, timezone, is_demo')
    .eq('id', gymId)
    .maybeSingle();

  if (inQuietHours(gym?.timezone ?? 'Europe/London')) {
    return json({ ok: true, mode: 'quiet_hours', sent: 0 });
  }

  const { data: rows, error: rErr } = await service
    .from('member_outbound_messages')
    .select('id, profile_id, channel, subject, body, attempts')
    .eq('gym_id', gymId)
    .in('status', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS);
  if (rErr) return json({ error: rErr.message }, 500);

  const queue = (rows as Row[] | null) ?? [];
  if (queue.length === 0) return json({ ok: true, sent: 0, failed: 0 });

  // The gym's own number, and how many texts it has already sent today.
  // daily_message_cap has bounded the agent's Twilio spend since 0143;
  // member texts spend from the same account and belong under the same
  // ceiling.
  const { data: agent } = await service
    .from('gym_agent_settings')
    .select('phone_number, sms_capable, daily_message_cap')
    .eq('gym_id', gymId)
    .maybeSingle();

  const smsQueue = queue.filter((r) => r.channel === 'sms');
  let smsBudget = 0;
  if (smsQueue.length > 0) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await service
      .from('member_outbound_messages')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gymId)
      .eq('channel', 'sms')
      .eq('status', 'sent')
      .gte('sent_at', since);
    smsBudget = Math.max(0, (agent?.daily_message_cap ?? 200) - (count ?? 0));
  }

  // One lookup for the whole drain rather than one per row.
  const profileIds = [...new Set(queue.map((r) => r.profile_id))];
  const { data: contacts } = await service
    .from('member_contact_details')
    .select('profile_id, phone_e164')
    .in('profile_id', profileIds);
  const phoneFor = new Map<string, string>();
  for (const c of (contacts ?? []) as { profile_id: string; phone_e164: string | null }[]) {
    if (c.phone_e164) phoneFor.set(c.profile_id, c.phone_e164);
  }

  const emailFor = new Map<string, string>();
  for (const id of profileIds) {
    const { data } = await service.auth.admin.getUserById(id);
    const address = data?.user?.email;
    if (address) emailFor.set(id, address);
  }

  // A demo gym is another reason not to send (0278) — both channels, and
  // the SMS one especially: a text reaches a handset somebody is holding.
  // The row is written 'simulated' either way, which is the same route the
  // no-credentials case has always taken. `=== false` on purpose: a gym row
  // we cannot read is not a gym we will send on behalf of.
  const realGym = gym?.is_demo === false;
  const emailLive = !!RESEND_API_KEY && !!RESEND_FROM && realGym;
  const smsLive =
    !!TWILIO_SID && !!TWILIO_TOKEN && !!agent?.phone_number && realGym;
  const gymName = gym?.name ?? 'your gym';
  const nowIso = new Date().toISOString();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let simulated = 0;

  const mark = async (
    id: string,
    patch: Record<string, unknown>,
  ) => {
    await service.from('member_outbound_messages').update(patch).eq('id', id);
  };

  async function deliverEmail(r: Row): Promise<void> {
    const address = emailFor.get(r.profile_id);
    if (!address) {
      await mark(r.id, { status: 'skipped', error: 'No email address' });
      skipped += 1;
      return;
    }
    if (!emailLive) {
      await mark(r.id, { status: 'sent', sent_at: nowIso, attempts: r.attempts + 1 });
      simulated += 1;
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
        'Idempotency-Key': `member:${r.id}`,
      },
      body: JSON.stringify({
        from: `${gymName} <${RESEND_FROM}>`,
        to: [address],
        subject: r.subject ?? gymName,
        html: templeEmailHtml({
          title: r.subject ?? gymName,
          bodyHtml: `<p>${escapeHtml(r.body)}</p>`,
        }),
        text: r.body,
      }),
    });
    if (!res.ok) {
      await mark(r.id, {
        status: 'failed',
        error: (await res.text()).slice(0, 500),
        attempts: r.attempts + 1,
      });
      failed += 1;
      return;
    }
    await mark(r.id, {
      status: 'sent',
      sent_at: nowIso,
      error: null,
      attempts: r.attempts + 1,
    });
    sent += 1;
  }

  async function deliverSms(r: Row): Promise<void> {
    const to = phoneFor.get(r.profile_id);
    if (!to) {
      await mark(r.id, { status: 'skipped', error: 'No dialable number' });
      skipped += 1;
      return;
    }
    // A cap reached mid-drain leaves the row queued, not failed: the
    // message is still wanted, it just waits for tomorrow's budget.
    if (smsBudget <= 0) {
      skipped += 1;
      return;
    }
    if (!smsLive) {
      await mark(r.id, { status: 'sent', sent_at: nowIso, attempts: r.attempts + 1 });
      simulated += 1;
      smsBudget -= 1;
      return;
    }
    smsBudget -= 1;
    const out = await sendTwilioSms(
      TWILIO_SID!,
      TWILIO_TOKEN!,
      agent!.phone_number as string,
      to,
      r.body,
    );
    if (out.error) {
      await mark(r.id, {
        status: 'failed',
        error: out.error.slice(0, 500),
        attempts: r.attempts + 1,
      });
      failed += 1;
      return;
    }
    await mark(r.id, {
      status: 'sent',
      sent_at: nowIso,
      error: null,
      attempts: r.attempts + 1,
    });
    sent += 1;
  }

  // Serial rather than the usual pool of 8: SMS spends real money against
  // a budget this loop decrements, and eight workers racing that counter
  // would overshoot the gym's cap by up to seven texts.
  for (const r of queue) {
    try {
      if (r.channel === 'sms') await deliverSms(r);
      else await deliverEmail(r);
    } catch (e) {
      await mark(r.id, {
        status: 'failed',
        error: String(e).slice(0, 500),
        attempts: r.attempts + 1,
      });
      failed += 1;
    }
  }

  return json({
    ok: true,
    mode: emailLive || smsLive ? 'live' : 'simulated',
    sent,
    failed,
    skipped,
    simulated,
  });
});
