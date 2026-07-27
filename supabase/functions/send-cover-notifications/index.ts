// Cover notification worker.
//
// Drains queued email rows from cover_notifications for a gym and sends
// them via Resend, then writes back per-row status. Invoked best-effort by
// the client right after a cover request is lodged or an offer is claimed,
// and retryable by re-invoking. Everything is idempotent: the in-app half
// of the notification is already delivered by the DB (0165), this only
// handles email.
//
// Two kinds, two audiences:
//   cover_requested — to every coach who could claim, ONE digest naming
//                     the window and the class count, never one per class.
//   cover_claimed   — back to the requester, per class, naming the coach
//                     who picked it up.
//
// Authorisation mirrors send-lead-notifications: draining is benign. It
// dispatches an already-decided notification to a gym member's own address
// (not attacker-controlled), returns only counts, and the Resend
// idempotency key makes a repeat invoke a no-op. The queue rows were
// written by security-definer RPCs that enforced tenancy and suppression.
//
// Delivery is pluggable: with RESEND_API_KEY + a from-address it sends for
// real; without them it records the row 'sent' and reports mode
// 'simulated', so the loop is demonstrable before a sending domain exists.
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

type Row = {
  id: string;
  kind: 'cover_requested' | 'cover_claimed' | 'cover_uncovered';
  recipient: string | null;
  request_id: string;
  offer_id: string | null;
};

type RequestSummary = {
  requesterName: string;
  classCount: number;
  window: string;
};

// Recomputed at send time rather than stamped on the notification row:
// the warning repeats daily while the problem persists, and by the time
// the second one goes out some of the classes may have been claimed.
type UncoveredSummary = {
  requesterName: string;
  uncoveredCount: number;
  firstAt: string | null;
};

type ClaimSummary = {
  claimerName: string;
  className: string;
  when: string;
};

// DD/MM/YYYY, matching src/lib/format-date.ts — the platform shows dates
// this way everywhere outside the calendars.
function ddmmyyyy(iso: string): string {
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
}

function whenLabel(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function requestedEmailHtml(
  gymName: string,
  s: RequestSummary,
  link: string,
): string {
  const g = escapeHtml(gymName);
  const who = escapeHtml(s.requesterName);
  const classes = `${s.classCount} ${s.classCount === 1 ? 'class' : 'classes'}`;
  return templeEmailHtml({
    title: 'Cover needed',
    preheader: `${s.requesterName} needs cover for ${classes} at ${gymName}.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        <strong>${who}</strong> has asked for cover at <strong>${g}</strong> —
        <strong>${escapeHtml(classes)}</strong> ${escapeHtml(s.window)}.
      </p>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        First claim wins. Open Temple to see the classes and take any that
        suit you.
      </p>`,
    button: { label: 'See what needs cover', url: link },
    footerNote: "You're receiving this because you coach at this gym.",
  });
}

// The warning lead is gyms.cover_warning_hours (0167), so the copy has
// to say the gym's own number rather than a baked-in 48.
function leadHoursLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '24 hours' : `${days} days`;
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function uncoveredEmailHtml(
  gymName: string,
  s: UncoveredSummary,
  lead: string,
  link: string,
): string {
  const who = escapeHtml(s.requesterName);
  const n = s.uncoveredCount;
  const classes = `${n} ${n === 1 ? 'class' : 'classes'}`;
  const firstLine = s.firstAt
    ? `<p style="margin:0 0 18px;">The first is <strong>${escapeHtml(
        s.firstAt,
      )}</strong>.</p>`
    : '';
  return templeEmailHtml({
    title: 'Still no cover',
    preheader: `${classes} at ${gymName} run within ${lead} with no coach.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        <strong>${escapeHtml(classes)}</strong> that ${who} asked cover for
        run within the next ${escapeHtml(lead)} and nobody has claimed them.
      </p>
      ${firstLine}
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        Someone needs to take these or the classes go ahead without a coach.
      </p>`,
    button: { label: 'Sort out cover', url: link },
    footerNote:
      "You're receiving this because you asked for this cover, or you run this gym.",
  });
}

function claimedEmailHtml(
  gymName: string,
  s: ClaimSummary,
  link: string,
): string {
  const who = escapeHtml(s.claimerName);
  const cls = escapeHtml(s.className);
  const when = escapeHtml(s.when);
  return templeEmailHtml({
    title: 'Your class is covered',
    preheader: `${s.claimerName} picked up ${s.className} on ${s.when}.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        <strong>${who}</strong> has picked up your <strong>${cls}</strong> on
        <strong>${when}</strong> at ${escapeHtml(gymName)}.
      </p>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        Any classes still waiting for a coach are listed under your requests
        in Temple.
      </p>`,
    button: { label: 'View your cover requests', url: link },
    footerNote: "You're receiving this because you asked for cover.",
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
      .from('cover_notifications')
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
    .from('cover_notifications')
    .select('id, kind, recipient, request_id, offer_id')
    .eq('channel', 'email')
    .eq('status', 'queued');
  if (notificationId) query = query.eq('id', notificationId);
  else if (gymId) query = query.eq('gym_id', gymId);

  const { data: rows, error: rErr } = await query;
  if (rErr) return json({ error: rErr.message }, 500);

  const queue = (rows as Row[] | null) ?? [];
  if (queue.length === 0) {
    return json({ ok: true, mode: 'idle', sent: 0, failed: 0, simulated: 0 });
  }

  const [{ data: gym }, { data: settings }, { data: sendingDomain }] =
    await Promise.all([
      service
        .from('gyms')
        .select('name, timezone, cover_warning_hours')
        .eq('id', gymId ?? '')
        .maybeSingle(),
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
  const gymTz = gym?.timezone ?? 'UTC';
  const leadLabel = leadHoursLabel(gym?.cover_warning_hours ?? 48);
  const fromName = settings?.from_name || gymName;
  const replyTo = settings?.reply_to || undefined;
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;

  const live = Boolean(RESEND_API_KEY && fromAddress);
  const link = `${origin}/management/cover`;

  // One lookup per distinct request / offer rather than per row: a
  // cover_requested fan-out is N rows describing the same request.
  const requestIds = [...new Set(queue.map((r) => r.request_id))];
  const offerIds = [
    ...new Set(queue.map((r) => r.offer_id).filter((v): v is string => !!v)),
  ];

  const requestSummaries = new Map<string, RequestSummary>();
  const claimSummaries = new Map<string, ClaimSummary>();
  const uncoveredSummaries = new Map<string, UncoveredSummary>();

  if (requestIds.length > 0) {
    const { data: reqs } = await service
      .from('cover_requests')
      .select(
        'id, range_start, range_end, requested_start, requested_end, requester:profiles!requested_by(full_name), cover_request_sessions(id)',
      )
      .in('id', requestIds);
    for (const r of (reqs ?? []) as unknown as {
      id: string;
      range_start: string;
      range_end: string;
      requested_start: string | null;
      requested_end: string | null;
      requester: { full_name: string | null } | null;
      cover_request_sessions: { id: string }[];
    }[]) {
      const from = r.requested_start ?? r.range_start;
      const to = r.requested_end ?? r.range_end;
      const fromLabel = ddmmyyyy(from);
      const toLabel = ddmmyyyy(to);
      requestSummaries.set(r.id, {
        requesterName: r.requester?.full_name ?? 'A coach',
        classCount: r.cover_request_sessions?.length ?? 0,
        window:
          fromLabel === toLabel
            ? `on ${fromLabel}`
            : `between ${fromLabel} and ${toLabel}`,
      });
    }
  }

  const uncoveredRequestIds = [
    ...new Set(
      queue.filter((r) => r.kind === 'cover_uncovered').map((r) => r.request_id),
    ),
  ];
  if (uncoveredRequestIds.length > 0) {
    const { data: stillOpen } = await service
      .from('cover_request_sessions')
      .select('request_id, class_sessions!inner(starts_at)')
      .in('request_id', uncoveredRequestIds)
      .is('claimed_by', null)
      .gt('class_sessions.starts_at', new Date().toISOString())
      .order('starts_at', { referencedTable: 'class_sessions', ascending: true });
    for (const id of uncoveredRequestIds) {
      const mine = ((stillOpen ?? []) as unknown as {
        request_id: string;
        class_sessions: { starts_at: string } | null;
      }[]).filter((r) => r.request_id === id);
      const starts = mine
        .map((r) => r.class_sessions?.starts_at)
        .filter((v): v is string => !!v)
        .sort();
      uncoveredSummaries.set(id, {
        requesterName: requestSummaries.get(id)?.requesterName ?? 'A coach',
        uncoveredCount: mine.length,
        firstAt: starts.length > 0 ? whenLabel(starts[0], gymTz) : null,
      });
    }
  }

  if (offerIds.length > 0) {
    const { data: offers } = await service
      .from('cover_request_sessions')
      .select(
        'id, claimer:profiles!claimed_by(full_name), class_sessions(name, starts_at, class_types(name))',
      )
      .in('id', offerIds);
    for (const o of (offers ?? []) as unknown as {
      id: string;
      claimer: { full_name: string | null } | null;
      class_sessions: {
        name: string;
        starts_at: string;
        class_types: { name: string } | null;
      } | null;
    }[]) {
      claimSummaries.set(o.id, {
        claimerName: o.claimer?.full_name ?? 'Another coach',
        className:
          o.class_sessions?.class_types?.name ?? o.class_sessions?.name ?? 'class',
        when: o.class_sessions
          ? whenLabel(o.class_sessions.starts_at, gymTz)
          : 'the scheduled time',
      });
    }
  }

  let sent = 0;
  let failed = 0;
  let simulated = 0;

  async function deliver(r: Row) {
    const nowIso = new Date().toISOString();
    const to = r.recipient;
    if (!to) {
      await service
        .from('cover_notifications')
        .update({ status: 'skipped', error: 'No recipient address' })
        .eq('id', r.id);
      return;
    }

    if (!live) {
      await service
        .from('cover_notifications')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    let subject: string;
    let html: string;
    let text: string;

    if (r.kind === 'cover_uncovered') {
      const s = uncoveredSummaries.get(r.request_id);
      // Everything got claimed between the sweep and the drain — the
      // warning is moot, so don't send it.
      if (!s || s.uncoveredCount === 0) {
        await service
          .from('cover_notifications')
          .update({ status: 'skipped', error: 'Cover was found before sending' })
          .eq('id', r.id);
        return;
      }
      const classes = `${s.uncoveredCount} ${
        s.uncoveredCount === 1 ? 'class' : 'classes'
      }`;
      subject = `Still no cover for ${classes}`;
      html = uncoveredEmailHtml(gymName, s, leadLabel, link);
      text =
        `${classes} that ${s.requesterName} asked cover for run within the next ` +
        `${leadLabel} and nobody has claimed them.` +
        (s.firstAt ? ` The first is ${s.firstAt}.` : '') +
        `\n\nSort out cover: ${link}`;
    } else if (r.kind === 'cover_claimed') {
      const s = claimSummaries.get(r.offer_id ?? '');
      if (!s) {
        await service
          .from('cover_notifications')
          .update({ status: 'skipped', error: 'Offer no longer exists' })
          .eq('id', r.id);
        return;
      }
      subject = `${s.claimerName} is covering your ${s.className}`;
      html = claimedEmailHtml(gymName, s, link);
      text =
        `${s.claimerName} has picked up your ${s.className} on ${s.when} at ${gymName}.\n\n` +
        `View your cover requests: ${link}`;
    } else {
      const s = requestSummaries.get(r.request_id);
      if (!s) {
        await service
          .from('cover_notifications')
          .update({ status: 'skipped', error: 'Request no longer exists' })
          .eq('id', r.id);
        return;
      }
      const classes = `${s.classCount} ${s.classCount === 1 ? 'class' : 'classes'}`;
      subject = `Cover needed: ${classes} ${s.window}`;
      html = requestedEmailHtml(gymName, s, link);
      text =
        `${s.requesterName} has asked for cover at ${gymName} — ${classes} ${s.window}.\n\n` +
        `First claim wins. See what needs cover: ${link}`;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // One notification row = one send; dedupes retries/double-invokes.
          'Idempotency-Key': `cover:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject,
          html,
          text,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('cover_notifications')
          .update({ status: 'failed', error: errTxt })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('cover_notifications')
        .update({ status: 'sent', sent_at: nowIso, error: null })
        .eq('id', r.id);
      sent += 1;
    } catch (e) {
      await service
        .from('cover_notifications')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', r.id);
      failed += 1;
    }
  }

  // Concurrency-limited fan-out, same rationale as send-lead-notifications:
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
