// Lead-to-coach notification worker.
//
// Drains queued email rows from lead_notifications for a gym and sends them
// via Resend, then writes back per-row status. Invoked best-effort by the
// client right after a lead is captured (staff form and the public
// /lead/<slug> form both pass the gym id), and again from the owner screen
// to retry a failed send. Everything is idempotent: the in-app half of the
// notification is already delivered by the DB, this only handles email.
//
// Why no per-caller authorisation (unlike send-campaign): the public
// capture path is anonymous, so there is no JWT to re-authorise. Draining
// is benign — it dispatches an already-decided notification to the assigned
// coach's own address (not attacker-controlled), returns only counts, and
// the Resend idempotency key makes a repeat invoke a no-op. The queue rows
// themselves were written by security-definer RPCs that enforced tenancy.
//
// Delivery is pluggable: with RESEND_API_KEY + a from-address it sends for
// real; without them it records the row 'sent' and reports mode 'simulated'
// so the loop is demonstrable end-to-end before a sending domain is wired.
//
// SMS is a seam: any queued channel='sms' rows are marked 'skipped' until a
// provider is added.
//
// Required env (SUPABASE_* injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env to go live:
//   RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymMember, safeOrigin } from '../_shared/caller.ts';

import { escapeHtml, templeEmailHtml } from '../_shared/email-layout.ts';

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

type Lead = { full_name: string; email: string | null; phone: string | null };
type Row = {
  id: string;
  channel: string;
  recipient: string | null;
  lead_id: string;
  leads: Lead | null;
};

function leadEmailHtml(gymName: string, leadName: string, link: string): string {
  const g = escapeHtml(gymName);
  const l = escapeHtml(leadName);
  return templeEmailHtml({
    title: 'A new lead is yours',
    preheader: `${leadName} just enquired at ${gymName}.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        <strong>${l}</strong> has just enquired at <strong>${g}</strong> and
        has been assigned to you. Reach out while it's fresh — the first reply
        wins the trial.
      </p>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        Open the lead in Temple to see their details and log your follow-up.
      </p>`,
    button: { label: 'View the lead', url: link },
    footerNote: "You're receiving this because you coach at this gym.",
  });
}

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

  let body: { gym_id?: string; notification_id?: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const notificationId = body.notification_id;
  if (!gymId && !notificationId) {
    return json({ error: 'gym_id or notification_id is required' }, 400);
  }

  // The public /lead/<slug> capture form invokes this with no JWT, so a
  // membership check would break the very path this exists for. Instead:
  // constrain the origin that reaches the email, and tell an anonymous
  // caller nothing back. The counts were the whole probe — knowing how
  // many lead emails a rival gym has queued is a business fact.
  const known = gymId
    ? await requireGymMember(req, gymId, SUPABASE_URL, ANON_KEY, SERVICE_KEY)
    : ({ ok: false, status: 403, error: 'Not authorised' } as const);
  const origin = await safeOrigin(
    body.origin, gymId ?? '', SUPABASE_URL, SERVICE_KEY);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // Park any queued SMS rows in scope as skipped — the documented seam.
  {
    let smsQuery = service
      .from('lead_notifications')
      .update({ status: 'skipped', error: 'SMS provider not configured' })
      .eq('channel', 'sms')
      .eq('status', 'queued');
    if (notificationId) smsQuery = smsQuery.eq('id', notificationId);
    else if (gymId) smsQuery = smsQuery.eq('gym_id', gymId);
    await smsQuery;
  }

  let query = service
    .from('lead_notifications')
    .select('id, channel, recipient, lead_id, leads!lead_id(full_name, email, phone)')
    .eq('channel', 'email')
    .eq('status', 'queued');
  if (notificationId) query = query.eq('id', notificationId);
  else if (gymId) query = query.eq('gym_id', gymId);

  const { data: rows, error: rErr } = await query;
  if (rErr) return json({ error: rErr.message }, 500);

  const [{ data: gym }, { data: settings }, { data: sendingDomain }] =
    await Promise.all([
      service.from('gyms').select('name, is_demo').eq('id', gymId ?? '').maybeSingle(),
      service
        .from('gym_comms_settings')
        .select('from_name, reply_to')
        .eq('gym_id', gymId ?? '')
        .maybeSingle(),
      service
        .from('gym_sending_domains')
        .select('domain, from_local, status')
        .eq('gym_id', gymId ?? '')
        .maybeSingle(),
    ]);

  const gymName = gym?.name ?? 'your gym';
  const fromName = settings?.from_name || gymName;
  const replyTo = settings?.reply_to || undefined;
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;

  // A demo gym is another reason not to send (0278). It takes the route
  // the no-ESP case has always taken: the row is written 'simulated' and
  // the report counts it, so the product still shows what it did. Read as
  // `=== false` rather than `!== true` on purpose — a gym row we cannot
  // read is not a gym we will send mail on behalf of.
  const live = Boolean(RESEND_API_KEY && fromAddress) && gym?.is_demo === false;
  const link = `${origin}/management/leads`;
  let sent = 0;
  let failed = 0;
  let simulated = 0;

  async function deliver(r: Row) {
    const nowIso = new Date().toISOString();
    const to = r.recipient;
    if (!to) {
      await service
        .from('lead_notifications')
        .update({ status: 'skipped', error: 'No recipient address' })
        .eq('id', r.id);
      return;
    }

    if (!live) {
      await service
        .from('lead_notifications')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    const leadName = r.leads?.full_name ?? 'A new prospect';
    const html = leadEmailHtml(gymName, leadName, link);
    const text =
      `${leadName} has just enquired at ${gymName} and has been assigned to you.\n\n` +
      `Open Temple to see their details and follow up: ${link}`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // One notification row = one send; dedupes retries/double-invokes.
          'Idempotency-Key': `lead:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject: `New lead: ${leadName}`,
          html,
          text,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('lead_notifications')
          .update({ status: 'failed', error: errTxt })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('lead_notifications')
        .update({ status: 'sent', sent_at: nowIso, error: null })
        .eq('id', r.id);
      sent += 1;
    } catch (e) {
      await service
        .from('lead_notifications')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', r.id);
      failed += 1;
    }
  }

  // Concurrency-limited fan-out, same rationale as send-campaign: stay
  // inside Supabase Edge's 60s wall and Resend's rate limit.
  const CONCURRENCY = 8;
  const queue = [...((rows as unknown as Row[]) ?? [])];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) return;
          await deliver(next);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return known.ok
    ? json({ ok: true, mode: live ? 'live' : 'simulated', sent, failed, simulated })
    : json({ ok: true });
});
