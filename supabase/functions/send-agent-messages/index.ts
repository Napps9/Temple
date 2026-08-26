// The money loop's outbound sender (docs/loop-1-payment-recovery.md).
//
// Drains queued agent_outbound_messages for one gym and sends them via
// Resend. The text was filled from an owner-approved template by
// _agent_execute_action — no model anywhere near the send path. Invoked
// by the dispatch-agent-messages cron with the Vault service key, and
// best-effort from the Timeline after an approval.
//
// Quiet hours are enforced HERE, not at approval: an owner who taps
// "Yes, send it" at 10pm shouldn't be refused — the message waits in the
// queue and goes out after 09:00 gym-local. Sends only 09:00–20:00.
//
// Follows send-payment-notifications: same auth (can_see_money, or the
// service key), same retry budget, same address resolution at send time
// so emails never land on a staff-readable row. A failing payment is not
// marketing (0175), so no campaign unsubscribe applies.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymCapability } from '../_shared/caller.ts';

import { escapeHtml, templeEmailHtml } from '../_shared/email-layout.ts';
import { inQuietHours } from '../_shared/gym-clock.ts';
import { loadSuppressed, SUPPRESSED_REASON } from '../_shared/suppression.ts';

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

type Row = {
  id: string;
  recipient_profile_id: string | null;
  subject: string;
  body: string;
  attempts: number;
};

const MAX_ATTEMPTS = 3;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');
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

  const who = await requireGymCapability(
    req, gymId, 'can_see_money', SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!who.ok) return json({ error: who.error }, who.status);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: gym } = await service
    .from('gyms')
    .select('name, timezone')
    .eq('id', gymId)
    .maybeSingle();

  if (inQuietHours(gym?.timezone ?? 'Europe/London')) {
    return json({ ok: true, mode: 'quiet_hours', sent: 0 });
  }

  const { data: rows, error: rErr } = await service
    .from('agent_outbound_messages')
    .select('id, recipient_profile_id, subject, body, attempts')
    .eq('gym_id', gymId)
    .in('status', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS);
  if (rErr) return json({ error: rErr.message }, 500);

  const queue = (rows as Row[] | null) ?? [];
  if (queue.length === 0) {
    return json({ ok: true, mode: 'idle', sent: 0, failed: 0, simulated: 0 });
  }

  const [{ data: settings }, { data: sendingDomain }] = await Promise.all([
    service
      .from('gym_comms_settings')
      .select('from_name, reply_to')
      .eq('gym_id', gymId)
      .maybeSingle(),
    service
      .from('gym_sending_domains')
      .select('domain, from_local, status')
      .eq('gym_id', gymId)
      .maybeSingle(),
  ]);

  const emailByProfile = new Map<string, string>();
  await Promise.all(
    [...new Set(queue.map((r) => r.recipient_profile_id).filter(Boolean))].map(
      async (id) => {
        const { data } = await service.auth.admin.getUserById(id as string);
        if (data?.user?.email) emailByProfile.set(id as string, data.user.email);
      },
    ),
  );

  const gymName = gym?.name ?? 'your gym';
  const fromName = settings?.from_name || gymName;
  const replyTo = settings?.reply_to || undefined;
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;

  const live = Boolean(RESEND_API_KEY && fromAddress);
  // The sixth place this has to be honoured, and the one that was
  // missed. 0229's comment names the transactional senders — class
  // changes, cover, payment notices, automations — and the jobs' own
  // sender is not on that list, so a hard-bounced address kept getting
  // every retention, first-week, top-up and upgrade message the gym
  // proposed. It matters more now the class-return job exists: one
  // approval queues up to twelve rows, so one bad address is no longer
  // one refused send but a share of a fan-out, every quarter, for a
  // person who cannot read any of it.
  const suppressed = await loadSuppressed(service, [gymId!]);

  let sent = 0;
  let failed = 0;
  let simulated = 0;

  async function deliver(r: Row): Promise<void> {
    const nowIso = new Date().toISOString();
    const to = r.recipient_profile_id
      ? emailByProfile.get(r.recipient_profile_id)
      : null;
    if (!to) {
      await service
        .from('agent_outbound_messages')
        .update({ status: 'skipped', error: 'No email address' })
        .eq('id', r.id);
      return;
    }

    if (suppressed.has(gymId!, to)) {
      await service
        .from('agent_outbound_messages')
        .update({ status: 'skipped', error: SUPPRESSED_REASON })
        .eq('id', r.id);
      return;
    }

    if (!live) {
      await service
        .from('agent_outbound_messages')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          'Idempotency-Key': `agent-msg:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject: r.subject,
          html: templeEmailHtml({
            title: r.subject,
            preheader: r.body.slice(0, 140),
            bodyHtml: `<p style="margin:0 0 18px;white-space:pre-line;">${escapeHtml(r.body)}</p>`,
            footerNote:
              "You're receiving this because you have a membership at this gym.",
          }),
          text: r.body,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('agent_outbound_messages')
          .update({ status: 'failed', error: errTxt, attempts: r.attempts + 1 })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('agent_outbound_messages')
        .update({
          status: 'sent',
          sent_at: nowIso,
          error: null,
          attempts: r.attempts + 1,
        })
        .eq('id', r.id);
      sent += 1;
    } catch (e) {
      await service
        .from('agent_outbound_messages')
        .update({
          status: 'failed',
          error: String(e).slice(0, 500),
          attempts: r.attempts + 1,
        })
        .eq('id', r.id);
      failed += 1;
    }
  }

  const CONCURRENCY = 8;
  const pending = [...queue];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (pending.length > 0) {
          const next = pending.shift();
          if (!next) return;
          await deliver(next);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return json({ ok: true, mode: live ? 'live' : 'simulated', sent, failed, simulated });
});
