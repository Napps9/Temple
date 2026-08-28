// Class-change notification worker.
//
// Drains queued email rows from class_change_notifications for a gym and
// sends them via Resend, then writes back per-row status. Invoked
// best-effort by the client right after a gym closure or a bulk edit, and
// retryable by re-invoking. The in-app half is already delivered by the DB
// (0169); this only handles email.
//
// Simpler than send-cover-notifications in one respect that matters: the
// message text lives on the row. The classes these notifications describe
// have been deleted, so there is nothing left to join to at send time —
// close_gym_dates renders the digest line when it still can and stores it.
//
// Authorisation mirrors send-cover-notifications: draining is benign. It
// dispatches an already-decided notification to a gym member's own address
// (not attacker-controlled), returns only counts, and the Resend
// idempotency key makes a repeat invoke a no-op. The queue rows were
// written by security-definer RPCs that enforced tenancy and suppression.
//
// Required env (SUPABASE_* injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env to go live:
//   RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymMember, safeOrigin } from '../_shared/caller.ts';

import { escapeHtml, templeEmailHtml } from '../_shared/email-layout.ts';
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
  kind: 'gym_closed' | 'classes_rescheduled' | 'classes_reopened';
  recipient: string | null;
  body: string;
};

const COPY: Record<
  Row['kind'],
  { title: string; tail: (gym: string) => string; button: string }
> = {
  gym_closed: {
    title: 'The gym is closed',
    tail: (gym) =>
      `Nothing to do — any credits you used have already been returned to your account at ${gym}.`,
    button: 'See the timetable',
  },
  classes_rescheduled: {
    title: 'Your class times have changed',
    tail: (gym) => `Open Temple to check the new times for your bookings at ${gym}.`,
    button: 'Check your bookings',
  },
  // The one kind that needs an action: the credit went back when the gym
  // shut, so the class returning does nothing unless they rebook it.
  classes_reopened: {
    title: 'Your class is back on',
    tail: (gym) =>
      `Your place was not held while ${gym} was closed, so book again to get it back.`,
    button: 'Book your class',
  },
};

function emailHtml(
  gymName: string,
  kind: Row['kind'],
  body: string,
  link: string,
): string {
  const copy = COPY[kind] ?? COPY.classes_rescheduled;
  return templeEmailHtml({
    title: copy.title,
    preheader: body.slice(0, 140),
    bodyHtml: `<p style="margin:0 0 18px;">${escapeHtml(body)}</p>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        ${escapeHtml(copy.tail(gymName))}
      </p>`,
    button: { label: copy.button, url: link },
    footerNote:
      "You're receiving this because you had a class booked at this gym.",
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
  const notificationId = body.notification_id;
  if (!body.gym_id && !notificationId) {
    return json({ error: 'gym_id or notification_id is required' }, 400);
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // Resolve the gym from the row when the caller named a notification
  // rather than a gym, so the membership check below has something real to
  // check against rather than whatever the body claimed.
  let gymId = body.gym_id;
  if (!gymId && notificationId) {
    const { data: row } = await service
      .from('class_change_notifications')
      .select('gym_id')
      .eq('id', notificationId)
      .maybeSingle();
    gymId = row?.gym_id as string | undefined;
    if (!gymId) return json({ error: 'Not authorised' }, 403);
  }

  const who = await requireGymMember(
    req, gymId!, SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!who.ok) return json({ error: who.error }, who.status);

  const origin = await safeOrigin(body.origin, gymId!, SUPABASE_URL, SERVICE_KEY);

  let query = service
    .from('class_change_notifications')
    .select('id, kind, recipient, body')
    .eq('channel', 'email')
    .eq('status', 'queued');
  // ALWAYS scoped to the authorised gym. Filtering on id alone let a
  // caller pass a gym they belong to (satisfying requireGymMember) and
  // another gym's notification uuid, and operate on that row. The
  // gym-resolution fallback above only fires when gym_id is absent,
  // which is the case that was never the bypass.
  query = query.eq('gym_id', gymId!);
  if (notificationId) query = query.eq('id', notificationId);

  const { data: rows, error: rErr } = await query;
  if (rErr) return json({ error: rErr.message }, 500);

  const queue = (rows as Row[] | null) ?? [];
  if (queue.length === 0) {
    return json({ ok: true, mode: 'idle', sent: 0, failed: 0, simulated: 0 });
  }

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
  const link = `${origin}/book`;
  const suppressed = await loadSuppressed(service, [gymId!]);

  let sent = 0;
  let failed = 0;
  let simulated = 0;

  async function deliver(r: Row): Promise<void> {
    const nowIso = new Date().toISOString();
    const to = r.recipient;
    if (!to) {
      await service
        .from('class_change_notifications')
        .update({ status: 'skipped', error: 'No email address' })
        .eq('id', r.id);
      return;
    }

    if (suppressed.has(gymId!, to)) {
      await service
        .from('class_change_notifications')
        .update({ status: 'skipped', error: SUPPRESSED_REASON })
        .eq('id', r.id);
      return;
    }

    if (!live) {
      await service
        .from('class_change_notifications')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    const subject =
      r.kind === 'gym_closed'
        ? `${gymName} is closed — your classes have been cancelled`
        : r.kind === 'classes_reopened'
          ? `Your classes at ${gymName} are back on — book again`
          : `Your class times at ${gymName} have changed`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // One notification row = one send; dedupes retries/double-invokes.
          'Idempotency-Key': `class-change:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject,
          html: emailHtml(gymName, r.kind, r.body, link),
          text: `${r.body}\n\n${link}`,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('class_change_notifications')
          .update({ status: 'failed', error: errTxt })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('class_change_notifications')
        .update({ status: 'sent', sent_at: nowIso, error: null })
        .eq('id', r.id);
      sent += 1;
    } catch (e) {
      await service
        .from('class_change_notifications')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', r.id);
      failed += 1;
    }
  }

  // Concurrency-limited fan-out, same rationale as send-cover-notifications:
  // stay inside Supabase Edge's 60s wall and Resend's rate limit.
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
