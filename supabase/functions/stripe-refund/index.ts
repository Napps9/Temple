// Stripe billing — owner/staff-initiated refund of a member's payment.
//
// Four modes (see src/lib/refunds.ts — this file mirrors that maths so the
// server never trusts a client-supplied amount):
//   prorata_revoke  — refund the unused slice, cut access now, stop renewals
//   full_period_end — full refund, keep access to the paid period end, stop
//                     renewals
//   full_revoke     — full refund, cut access now, stop renewals
//   keep            — refund (full or a custom amount), leave access and
//                     renewals untouched (goodwill); marks the sub
//                     'refunded_retained'
//
// The refund runs on the gym's connected account (Stripe-Account header),
// against the most recent settled payment for the subscription. We then
// cancel the Stripe subscription as the mode dictates, update
// plan_subscriptions under the service role, and record a billing_events
// row (kind='refund' — intentionally NOT a revenue event, see
// is_revenue_event in 0019).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_SECRET_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

type RefundMode =
  | 'prorata_revoke'
  | 'full_period_end'
  | 'full_revoke'
  | 'keep';

type Outcome = {
  refundCents: number;
  access: 'revoke_now' | 'until_period_end' | 'unchanged';
  cancelRenewals: boolean;
  zeroCredits: boolean;
};

// --- Refund maths, mirrored from src/lib/refunds.ts. Keep the two in sync. -
function clampCents(n: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const r = Math.round(n);
  return r > max ? max : r;
}

function unusedFraction(
  kind: string,
  chargeCents: number,
  opts: {
    creditsTotal?: number | null;
    creditsRemaining?: number | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    now: string;
  },
): number {
  if (kind === 'credit_pack' || kind === 'credit_period') {
    const total = opts.creditsTotal ?? 0;
    const remaining = opts.creditsRemaining ?? 0;
    if (total <= 0 || remaining <= 0) return 0;
    return Math.min(1, remaining / total);
  }
  const start = opts.periodStart ? Date.parse(opts.periodStart) : NaN;
  const end = opts.periodEnd ? Date.parse(opts.periodEnd) : NaN;
  const t = Date.parse(opts.now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(t)) {
    return 0;
  }
  const span = end - start;
  if (span <= 0) return 0;
  const remaining = end - t;
  if (remaining <= 0) return 0;
  return Math.min(1, remaining / span);
}

function computeOutcome(
  mode: RefundMode,
  chargeCents: number,
  ctx: {
    kind: string;
    creditsTotal?: number | null;
    creditsRemaining?: number | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    now: string;
    customCents?: number | null;
  },
): Outcome {
  const full = clampCents(chargeCents, chargeCents);
  if (mode === 'prorata_revoke') {
    const frac = unusedFraction(ctx.kind, chargeCents, ctx);
    return {
      refundCents: clampCents(chargeCents * frac, chargeCents),
      access: 'revoke_now',
      cancelRenewals: true,
      zeroCredits: true,
    };
  }
  if (mode === 'full_revoke') {
    return { refundCents: full, access: 'revoke_now', cancelRenewals: true, zeroCredits: true };
  }
  if (mode === 'full_period_end') {
    return {
      refundCents: full,
      access: 'until_period_end',
      cancelRenewals: true,
      zeroCredits: false,
    };
  }
  // keep
  return {
    refundCents: ctx.customCents != null ? clampCents(ctx.customCents, full) : full,
    access: 'unchanged',
    cancelRenewals: false,
    zeroCredits: false,
  };
}
// ---------------------------------------------------------------------------

async function stripePost(
  path: string,
  params: Record<string, string>,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Account': account,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } })?.error?.message ??
        `Stripe ${path} failed`,
    );
  }
  return data as Record<string, unknown>;
}

function money(cents: number): string {
  return `£${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

// Best-effort "you've been refunded" email to the member. Never throws — a
// Resend hiccup must not turn a completed refund into a failure. From-address
// resolution mirrors the store-receipt sender (gym's verified domain, else
// the platform RESEND_FROM).
// deno-lint-ignore no-explicit-any
async function sendRefundEmail(
  service: any,
  args: {
    gymId: string;
    profileId: string;
    planName: string;
    refundCents: number;
    access: 'revoke_now' | 'until_period_end' | 'unchanged';
    periodEnd: string | null;
    refundId: string;
  },
  env: { resendKey?: string; resendFrom?: string },
): Promise<void> {
  try {
    if (!env.resendKey) return;
    const { data: userRes } = await service.auth.admin.getUserById(args.profileId);
    const email: string | undefined = userRes?.user?.email;
    if (!email) return;

    const [{ data: profile }, { data: gym }, { data: settings }, { data: domain }] =
      await Promise.all([
        service.from('profiles').select('full_name').eq('id', args.profileId).maybeSingle(),
        service.from('gyms').select('name').eq('id', args.gymId).maybeSingle(),
        service
          .from('gym_comms_settings')
          .select('from_name, reply_to')
          .eq('gym_id', args.gymId)
          .maybeSingle(),
        service
          .from('gym_sending_domains')
          .select('domain, from_local, status')
          .eq('gym_id', args.gymId)
          .maybeSingle(),
      ]);

    const fromAddress =
      domain?.status === 'verified' && domain.domain
        ? `${domain.from_local}@${domain.domain}`
        : env.resendFrom;
    if (!fromAddress) return;

    const gymName = (gym?.name as string) ?? 'your gym';
    const fromName = (settings?.from_name as string) || gymName;
    const firstName =
      ((profile?.full_name as string) ?? '').trim().split(/\s+/)[0] || 'there';

    const accessLine =
      args.access === 'revoke_now'
        ? `Your <strong>${escapeHtml(args.planName)}</strong> membership has now ended.`
        : args.access === 'until_period_end'
          ? `Your <strong>${escapeHtml(args.planName)}</strong> membership stays active until ${escapeHtml(fmtDate(args.periodEnd))}, then ends.`
          : `Your <strong>${escapeHtml(args.planName)}</strong> membership carries on as normal — nothing else changes.`;
    const accessText =
      args.access === 'revoke_now'
        ? `Your ${args.planName} membership has now ended.`
        : args.access === 'until_period_end'
          ? `Your ${args.planName} membership stays active until ${fmtDate(args.periodEnd)}, then ends.`
          : `Your ${args.planName} membership carries on as normal.`;

    const html = templeEmailHtml({
      title: 'You’ve been refunded',
      preheader: `${gymName} has refunded ${money(args.refundCents)}.`,
      bodyHtml: `<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 16px;"><strong>${escapeHtml(gymName)}</strong> has refunded <strong>${money(args.refundCents)}</strong> to your original payment method. It can take a few days to appear on your statement, depending on your bank.</p>
        <p style="margin:0 0 16px;">${accessLine}</p>
        <p style="margin:0;">Any questions, just reply to this email.</p>`,
      footerNote: `Sent by ${gymName} via Temple.`,
    });
    const text =
      `Hi ${firstName},\n\n${gymName} has refunded ${money(args.refundCents)} to your original payment method (it can take a few days to appear).\n\n${accessText}\n\nQuestions? Just reply to this email.`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': `refund:${args.refundId}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [email],
        subject: `Your refund from ${gymName}`,
        html,
        text,
        reply_to: settings?.reply_to || undefined,
      }),
    });
  } catch (_e) {
    // best-effort — the refund already succeeded
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  // Optional — the member notification simply doesn't send without them.
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) return json({ error: 'Stripe is not configured yet' }, 503);

  let body: {
    plan_subscription_id?: string;
    mode?: RefundMode;
    custom_cents?: number | null;
    notify_member?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const psId = body.plan_subscription_id;
  const mode = body.mode;
  const validModes: RefundMode[] = [
    'prorata_revoke',
    'full_period_end',
    'full_revoke',
    'keep',
  ];
  if (!psId || !mode || !validModes.includes(mode)) {
    return json({ error: 'plan_subscription_id and a valid mode are required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401);

  try {
    const { data: psRow } = await service
      .from('plan_subscriptions')
      .select(
        'id, gym_id, profile_id, plan_id, status, credit_balance, paid_period_end, stripe_subscription_id, created_at, membership_plans(name, kind, credit_count)',
      )
      .eq('id', psId)
      .maybeSingle();
    const ps = psRow as
      | {
          id: string;
          gym_id: string;
          profile_id: string;
          plan_id: string;
          status: string;
          credit_balance: number | null;
          paid_period_end: string | null;
          stripe_subscription_id: string | null;
          created_at: string;
          membership_plans: {
            name: string;
            kind: string;
            credit_count: number | null;
          } | null;
        }
      | null;
    if (!ps) return json({ error: 'Subscription not found' }, 404);

    // Refunds move money, so they use the money capability (owner-only by
    // default, grantable per-gym) — the same gate as revenue and billing,
    // not the broader can_assign_plan that coaches/staff hold.
    const { data: canRefund } = await caller.rpc('effective_can', {
      p_gym_id: ps.gym_id,
      p_capability: 'can_see_money',
    });
    if (!canRefund) return json({ error: 'Not allowed' }, 403);

    if (ps.status === 'refunded_retained' || ps.status === 'cancelled') {
      return json({ error: 'This subscription has already been refunded or cancelled' }, 409);
    }

    const { data: acctRow } = await service
      .from('gym_stripe_accounts')
      .select('stripe_account_id')
      .eq('gym_id', ps.gym_id)
      .maybeSingle();
    const account = acctRow?.stripe_account_id as string | undefined;
    if (!account) return json({ error: 'This gym has not connected Stripe yet' }, 409);

    // The payment to refund: the most recent settled charge recorded for
    // this subscription. Its amount is the basis for the pro-rata / full
    // maths, and its payment_intent/charge is what Stripe refunds against.
    const { data: beRow } = await service
      .from('billing_events')
      .select('amount_cents, occurred_at, payload')
      .eq('plan_subscription_id', ps.id)
      .in('kind', ['checkout', 'invoice'])
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!beRow) return json({ error: 'No settled payment found to refund' }, 409);

    const payload = (beRow.payload ?? {}) as Record<string, unknown>;
    const paymentIntent =
      typeof payload.payment_intent === 'string' ? payload.payment_intent : null;
    const charge = typeof payload.charge === 'string' ? payload.charge : null;
    if (!paymentIntent && !charge) {
      return json({ error: 'That payment has no refundable charge on Stripe' }, 409);
    }

    const chargeCents = beRow.amount_cents as number;
    const now = new Date().toISOString();
    const outcome = computeOutcome(mode, chargeCents, {
      kind: ps.membership_plans?.kind ?? 'unlimited',
      creditsTotal: ps.membership_plans?.credit_count,
      creditsRemaining: ps.credit_balance,
      periodStart: beRow.occurred_at as string,
      periodEnd: ps.paid_period_end,
      now,
      customCents: body.custom_cents,
    });

    // 1. Money back (skip a zero pro-rata — Stripe rejects a £0 refund, but
    //    the access change below still applies).
    let refundId: string | null = null;
    if (outcome.refundCents > 0) {
      const refund = await stripePost(
        'refunds',
        {
          ...(paymentIntent ? { payment_intent: paymentIntent } : { charge: charge! }),
          amount: String(outcome.refundCents),
          'metadata[gym_id]': ps.gym_id,
          'metadata[plan_subscription_id]': ps.id,
        },
        STRIPE_SECRET_KEY,
        account,
      );
      refundId = (refund.id as string) ?? null;
    }

    // 2. Stop / keep the Stripe subscription.
    if (ps.stripe_subscription_id && outcome.cancelRenewals) {
      if (outcome.access === 'revoke_now') {
        await stripePost(
          `subscriptions/${ps.stripe_subscription_id}/cancel`,
          {},
          STRIPE_SECRET_KEY,
          account,
        );
      } else {
        await stripePost(
          `subscriptions/${ps.stripe_subscription_id}`,
          { cancel_at_period_end: 'true' },
          STRIPE_SECRET_KEY,
          account,
        );
      }
    }

    // 3. Apply the entitlement change to plan_subscriptions.
    const update: Record<string, unknown> = {};
    if (outcome.access === 'revoke_now') {
      update.status = 'cancelled';
      update.cancelled_at = now;
      if (outcome.zeroCredits && ps.credit_balance !== null) update.credit_balance = 0;
    } else if (outcome.access === 'until_period_end') {
      update.status = 'cancelled_at_period_end';
    } else {
      update.status = 'refunded_retained';
    }
    const { error: upErr } = await service
      .from('plan_subscriptions')
      .update(update)
      .eq('id', ps.id);
    if (upErr) throw upErr;

    // 4. Record the refund (excluded from revenue by is_revenue_event).
    if (outcome.refundCents > 0 && refundId) {
      await service.from('billing_events').upsert(
        {
          provider: 'stripe',
          provider_event_id: refundId,
          provider_account_id: account,
          gym_id: ps.gym_id,
          plan_subscription_id: ps.id,
          member_id: ps.profile_id,
          kind: 'refund',
          amount_cents: outcome.refundCents,
          currency: 'GBP',
          occurred_at: now,
          payload: { mode, refund_id: refundId, source_charge_cents: chargeCents },
        },
        { onConflict: 'provider,provider_event_id', ignoreDuplicates: true },
      );
    }

    // 5. Tell the member — only when the owner asked and money actually moved.
    if (body.notify_member && outcome.refundCents > 0 && refundId) {
      await sendRefundEmail(
        service,
        {
          gymId: ps.gym_id,
          profileId: ps.profile_id,
          planName: ps.membership_plans?.name ?? 'membership',
          refundCents: outcome.refundCents,
          access: outcome.access,
          periodEnd: ps.paid_period_end,
          refundId,
        },
        { resendKey: RESEND_API_KEY, resendFrom: RESEND_FROM },
      );
    }

    return json({
      ok: true,
      refund_cents: outcome.refundCents,
      access: outcome.access,
      status: update.status,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
