// Failed-payment notification worker.
//
// Drains queued email rows from payment_notifications and sends them via
// Resend. The in-app half is already delivered by the DB (0175); this only
// handles email.
//
// Unlike the cover and class-change workers, there is NO CLIENT to invoke
// this. Those fire right after a staff member does something, so the
// browser that did it nudges the worker. A failed payment arrives from
// Stripe with nobody watching, so stripe-webhook invokes this directly
// after recording the failure, and the staff chase list nudges it again as
// a safety net. Anything still queued after both is picked up by the next
// invoke — a row is never lost, only delayed.
//
// The Pay now link is read here rather than stored on the notification:
// membership_invoice_links is deliberately self-only (0174), and joining
// it under the service role at send time avoids copying a bearer URL into
// a second table with a wider audience.
//
// The caller must belong to the gym they name (_shared/caller.ts), or be
// stripe-webhook calling with the service key. Without that check any
// authenticated account could name another gym and learn how many of its
// members had a queued email — and supply the `origin` that becomes the
// only link in the resulting payment email.
//
// Required env (SUPABASE_* injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional env to go live:
//   RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { requireGymCapability, safeOrigin } from '../_shared/caller.ts';

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
  kind: 'payment_failed' | 'payment_final_notice';
  recipient_profile_id: string | null;
  body: string;
  plan_subscription_id: string;
  attempts: number;
};

// A provider 429 must not be terminal. One notice per dunning run means
// nothing enqueues a replacement, so a row left at 'failed' would be a
// member who is simply never told. Re-picked until the budget runs out.
const MAX_ATTEMPTS = 3;

function emailHtml(
  gymName: string,
  kind: Row['kind'],
  body: string,
  payUrl: string | null,
  appUrl: string,
): string {
  const final = kind === 'payment_final_notice';
  return templeEmailHtml({
    title: final ? 'Your membership is about to stop' : "We couldn't take your payment",
    preheader: body.slice(0, 140),
    bodyHtml: `<p style="margin:0 0 18px;">${escapeHtml(body)}</p>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        ${
          payUrl
            ? 'Paying takes a minute and you can use a different card.'
            : `Get in touch with ${escapeHtml(gymName)} to update your card.`
        }
      </p>`,
    button: payUrl
      ? { label: 'Pay now', url: payUrl }
      : { label: 'View your membership', url: appUrl },
    footerNote: "You're receiving this because you have a membership at this gym.",
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

  let body: { gym_id?: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  if (!gymId) return json({ error: 'gym_id is required' }, 400);

  // can_see_money, not membership. The only client caller is the Money
  // block on the analysis screen, which is already behind that capability;
  // membership alone would let any member poll the response counts for how
  // many people at their gym have a failing card.
  const who = await requireGymCapability(
    req, gymId, 'can_see_money', SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!who.ok) return json({ error: who.error }, who.status);

  const origin = await safeOrigin(body.origin, gymId, SUPABASE_URL, SERVICE_KEY);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: rows, error: rErr } = await service
    .from('payment_notifications')
    .select('id, kind, recipient_profile_id, body, plan_subscription_id, attempts')
    .eq('gym_id', gymId)
    .eq('channel', 'email')
    .in('status', ['queued', 'failed'])
    .lt('attempts', MAX_ATTEMPTS);
  if (rErr) return json({ error: rErr.message }, 500);

  const queue = (rows as Row[] | null) ?? [];
  if (queue.length === 0) {
    return json({ ok: true, mode: 'idle', sent: 0, failed: 0, simulated: 0 });
  }

  const [{ data: gym }, { data: settings }, { data: sendingDomain }, { data: links }] =
    await Promise.all([
      service.from('gyms').select('name, is_demo').eq('id', gymId).maybeSingle(),
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
      service
        .from('membership_invoice_links')
        .select('plan_subscription_id, invoice_url')
        .in('plan_subscription_id', queue.map((r) => r.plan_subscription_id)),
    ]);

  // Addresses are resolved here, not read off the notification row: staff
  // with can_see_money can select those rows and can_see_email is a
  // separate capability, so the member's email never lands on one.
  const emailByProfile = new Map<string, string>();
  await Promise.all(
    [...new Set(queue.map((r) => r.recipient_profile_id).filter(Boolean))].map(
      async (id) => {
        const { data } = await service.auth.admin.getUserById(id as string);
        if (data?.user?.email) emailByProfile.set(id as string, data.user.email);
      },
    ),
  );

  const payUrlBySub = new Map<string, string>();
  for (const l of (links ?? []) as {
    plan_subscription_id: string;
    invoice_url: string;
  }[]) {
    payUrlBySub.set(l.plan_subscription_id, l.invoice_url);
  }

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
  const appUrl = `${origin}/membership`;
  const suppressed = await loadSuppressed(service, [gymId]);

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
        .from('payment_notifications')
        .update({ status: 'skipped', error: 'No email address' })
        .eq('id', r.id);
      return;
    }

    if (suppressed.has(gymId, to)) {
      await service
        .from('payment_notifications')
        .update({ status: 'skipped', error: SUPPRESSED_REASON })
        .eq('id', r.id);
      return;
    }

    if (!live) {
      await service
        .from('payment_notifications')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    const payUrl = payUrlBySub.get(r.plan_subscription_id) ?? null;
    const subject =
      r.kind === 'payment_final_notice'
        ? `Your ${gymName} membership is about to be cancelled`
        : `We couldn't take your ${gymName} payment`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // One notification row = one send; dedupes retries/double-invokes.
          'Idempotency-Key': `payment:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject,
          html: emailHtml(gymName, r.kind, r.body, payUrl, appUrl),
          text: `${r.body}\n\n${payUrl ?? appUrl}`,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('payment_notifications')
          .update({
            status: 'failed',
            error: errTxt,
            attempts: r.attempts + 1,
          })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('payment_notifications')
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
        .from('payment_notifications')
        .update({
          status: 'failed',
          error: String(e).slice(0, 500),
          attempts: r.attempts + 1,
        })
        .eq('id', r.id);
      failed += 1;
    }
  }

  // Concurrency-limited fan-out, same rationale as the other workers: stay
  // inside Supabase Edge's 60s wall and Resend's rate limit.
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
