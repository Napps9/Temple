// Stripe billing Phase 2 — webhook. Receives Connect events from gyms'
// connected accounts, verifies the signature, and records the result:
//   checkout.session.completed → create/activate the plan_subscription
//   invoice.paid               → extend paid_period_end (renewals), reset
//                                credit_period credits
//   customer.subscription.deleted → mark cancelled
// Every handled payment also writes a billing_events row (idempotent on
// the Stripe event id), which flips the gym's billing_live flag on.
//
// verify_jwt is off — Stripe carries no JWT; the signature is the guard.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//               STRIPE_WEBHOOK_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Verify the Stripe-Signature header (t=…,v1=…) with HMAC-SHA256 over
// `${t}.${rawBody}`, within a 5-minute tolerance.
async function verifySignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return mismatch === 0;
}

async function stripeGet(
  path: string,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Account': account },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

const ok = () =>
  new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!SUPABASE_URL || !SERVICE_KEY || !STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return new Response('Function is not configured', { status: 500 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get('Stripe-Signature') ?? '';
  if (!(await verifySignature(raw, sigHeader, WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const account: string | null = event.account ?? null; // connected account
  const type: string = event.type;
  // deno-lint-ignore no-explicit-any
  const obj: any = event.data?.object ?? {};
  console.log('stripe-webhook received', { type, account, eventId: event.id });

  async function recordBilling(args: {
    gymId: string;
    memberId: string;
    planSubId: string | null;
    kind: string;
    amountCents: number;
    currency: string;
  }) {
    await service.from('billing_events').upsert(
      {
        provider: 'stripe',
        provider_event_id: event.id,
        provider_account_id: account,
        gym_id: args.gymId,
        plan_subscription_id: args.planSubId,
        member_id: args.memberId,
        kind: args.kind,
        amount_cents: args.amountCents,
        currency: args.currency,
        occurred_at: new Date((event.created ?? Date.now() / 1000) * 1000).toISOString(),
        payload: obj,
      },
      { onConflict: 'provider,provider_event_id', ignoreDuplicates: true },
    );
  }

  try {
    if (type === 'checkout.session.completed') {
      const meta = obj.metadata ?? {};
      const gymId: string | undefined = meta.gym_id;
      const planId: string | undefined = meta.plan_id;
      const profileId: string | undefined = meta.profile_id;
      if (!gymId || !planId || !profileId) {
        console.warn('stripe-webhook checkout.session.completed: missing metadata', {
          gymId,
          planId,
          profileId,
          sessionId: obj.id,
        });
        return ok();
      }

      const { data: membership } = await service
        .from('gym_memberships')
        .select('id')
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .is('left_at', null)
        .maybeSingle();
      if (!membership) {
        console.warn(
          'stripe-webhook checkout.session.completed: no active gym_membership',
          { gymId, profileId },
        );
        return ok();
      }

      const { data: plan } = await service
        .from('membership_plans')
        .select('plan_id, kind, credit_count')
        .eq('plan_id', planId)
        .maybeSingle();
      if (!plan) {
        console.warn('stripe-webhook checkout.session.completed: plan not found', {
          planId,
        });
        return ok();
      }

      const customerId: string | null = obj.customer ?? null;
      const subId: string | null = obj.subscription ?? null;

      // Credit plans grant their credit_count; unlimited has no balance.
      const creditBalance =
        plan.kind === 'unlimited' ? null : (plan.credit_count as number | null);

      // Recurring plans get their renewal date from the subscription.
      // current_period_end moved off the Subscription onto its items in
      // newer API versions (2025-03+ / dahlia), so read whichever is set —
      // otherwise paid_period_end lands null and the member sees no renewal
      // date until the first invoice.paid.
      let paidPeriodEnd: string | null = null;
      if (subId && account) {
        const sub = await stripeGet(`subscriptions/${subId}`, STRIPE_SECRET_KEY, account);
        const items = (sub?.items as { data?: { current_period_end?: number }[] } | undefined)?.data;
        const cpe =
          (sub?.current_period_end as number | undefined) ??
          items?.[0]?.current_period_end;
        if (cpe) paidPeriodEnd = new Date(cpe * 1000).toISOString();
      }

      const row = {
        gym_membership_id: membership.id,
        profile_id: profileId,
        gym_id: gymId,
        plan_id: planId,
        status: 'active',
        credit_balance: creditBalance,
        paid_period_end: paidPeriodEnd,
        stripe_subscription_id: subId,
        stripe_customer_id: customerId,
      };

      // One row per Stripe subscription; credit packs (no sub) insert fresh
      // so repeat purchases stack as separate credit pools.
      // supabase-js does not throw on a failed write, so every insert /
      // update result is checked: a swallowed error here is a paid member
      // whose subscription silently never lands. Throwing reaches the
      // outer catch → 500 → Stripe retries (billing_events is idempotent).
      let planSubId: string | null = null;
      if (subId) {
        const { data: existing } = await service
          .from('plan_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();
        if (existing) {
          const { error: upErr } = await service
            .from('plan_subscriptions')
            .update(row)
            .eq('id', existing.id);
          if (upErr) throw upErr;
          planSubId = existing.id;
        } else {
          const { data: ins, error: insErr } = await service
            .from('plan_subscriptions')
            .insert(row)
            .select('id')
            .single();
          if (insErr) throw insErr;
          planSubId = ins?.id ?? null;
        }
      } else {
        const { data: ins, error: insErr } = await service
          .from('plan_subscriptions')
          .insert(row)
          .select('id')
          .single();
        if (insErr) throw insErr;
        planSubId = ins?.id ?? null;
      }

      console.log('stripe-webhook recorded subscription', {
        planSubId,
        gymId,
        profileId,
        planId,
        status: row.status,
      });

      await recordBilling({
        gymId,
        memberId: profileId,
        planSubId,
        kind: 'checkout',
        amountCents: (obj.amount_total as number) ?? 0,
        currency: ((obj.currency as string) ?? 'gbp').toUpperCase(),
      });
    } else if (type === 'invoice.paid') {
      const subId: string | null = obj.subscription ?? null;
      if (!subId) return ok();
      const { data: ps } = await service
        .from('plan_subscriptions')
        .select('id, gym_id, profile_id, plan_id')
        .eq('stripe_subscription_id', subId)
        .maybeSingle();
      // If the checkout event hasn't created the sub yet, skip — it will.
      if (!ps) {
        console.warn('stripe-webhook invoice.paid: no plan_subscription for sub', {
          subId,
        });
        return ok();
      }

      const line = obj.lines?.data?.[0];
      const periodEnd = line?.period?.end as number | undefined;
      const { data: plan } = await service
        .from('membership_plans')
        .select('kind, credit_count')
        .eq('plan_id', ps.plan_id)
        .maybeSingle();

      // deno-lint-ignore no-explicit-any
      const update: any = { status: 'active' };
      if (periodEnd) update.paid_period_end = new Date(periodEnd * 1000).toISOString();
      if (plan?.kind === 'credit_period') update.credit_balance = plan.credit_count;
      const { error: upErr } = await service
        .from('plan_subscriptions')
        .update(update)
        .eq('id', ps.id);
      if (upErr) throw upErr;

      await recordBilling({
        gymId: ps.gym_id,
        memberId: ps.profile_id,
        planSubId: ps.id,
        kind: 'invoice',
        amountCents: (obj.amount_paid as number) ?? 0,
        currency: ((obj.currency as string) ?? 'gbp').toUpperCase(),
      });
    } else if (type === 'customer.subscription.deleted') {
      const subId: string = obj.id;
      const { error: delErr } = await service
        .from('plan_subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subId);
      if (delErr) throw delErr;
    }
  } catch (e) {
    // 500 → Stripe retries; the idempotent billing_events insert makes
    // that safe.
    console.error('stripe-webhook handler error', e);
    return new Response('handler error', { status: 500 });
  }

  return ok();
});
