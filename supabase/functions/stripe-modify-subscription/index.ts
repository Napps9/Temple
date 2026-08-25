// Stripe billing — change or cancel a membership subscription.
//
// Three callers, one function:
//   action: 'self_serve' — a member changes their OWN subscription, but
//     only where the gym's policy allows it without approval (upgrade /
//     downgrade / cancel each configured self_serve vs request). Filing a
//     request when approval is needed is a plain RLS insert on the client;
//     this path is only the apply.
//   action: 'decide'     — staff with can_assign_plan approve or reject a
//     pending membership_change_request. Approve applies the same change;
//     reject just records the decision.
//   action: 'preview_switch' — a member asks what a switch would cost
//     before committing: the direction, and for an upgrade the exact
//     pro-rated charge Stripe would take today.
//
// The Stripe change runs on the gym's connected account as a direct
// charge. The two directions are deliberately different:
//   Upgrade — applied immediately, pro-rated (always_invoice): the member
//     gets the better plan today and pays the difference for the rest of
//     the period now, on their existing billing date. error_if_incomplete
//     means a declined card fails the switch instead of leaving the
//     subscription half-changed.
//   Downgrade (or an equal-price sideways move) — nothing changes
//     mid-cycle. The switch is recorded as pending_plan_id on the row and
//     the apply-plan-changes worker performs it at the first renewal on or
//     after the current plan's notice period (pending_change_not_before).
//     The member keeps everything they paid for; the price only ever drops
//     on a renewal date.
// Cancellations set cancel_at_period_end so the member keeps access
// through the period they've paid for.
//
// Decisions are applied here under the service role because RLS gives
// staff no write on membership_change_requests — keeping the Stripe call
// and the row update together.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_SECRET_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

async function stripeGet(
  path: string,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Account': account },
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

type Plan = {
  plan_id: string;
  gym_id: string;
  name: string;
  kind: 'unlimited' | 'credit_period' | 'credit_pack';
  credit_count: number | null;
  monthly_price_cents: number | null;
  stripe_price_id: string | null;
};

type PlanSub = {
  id: string;
  gym_id: string;
  profile_id: string;
  plan_id: string;
  status: string;
  price_cents: number | null;
  stripe_subscription_id: string | null;
  pending_plan_id: string | null;
};

const PS_COLUMNS =
  'id, gym_id, profile_id, plan_id, status, price_cents, stripe_subscription_id, pending_plan_id';

// A proration line in either Stripe API shape: classic invoices carry
// line.proration, dahlia moved it under line.parent.
function isProrationLine(line: Record<string, unknown>): boolean {
  if (line.proration === true) return true;
  const parent = line.parent as
    | { subscription_item_details?: { proration?: boolean } }
    | undefined;
  return parent?.subscription_item_details?.proration === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured yet' }, 503);
  }

  let body: {
    action?: 'self_serve' | 'decide' | 'preview_switch';
    plan_subscription_id?: string;
    kind?: 'switch_plan' | 'cancel';
    target_plan_id?: string;
    request_id?: string;
    decision?: 'approve' | 'reject';
    staff_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  async function accountFor(gymId: string): Promise<string | null> {
    const { data } = await service
      .from('gym_stripe_accounts')
      .select('stripe_account_id')
      .eq('gym_id', gymId)
      .maybeSingle();
    return (data?.stripe_account_id as string | undefined) ?? null;
  }

  async function loadPlan(planId: string, gymId: string): Promise<Plan | null> {
    const { data } = await service
      .from('membership_plans')
      .select(
        'plan_id, gym_id, name, kind, credit_count, monthly_price_cents, stripe_price_id, archived_at',
      )
      .eq('plan_id', planId)
      .eq('gym_id', gymId)
      .maybeSingle();
    if (!data || data.archived_at) return null;
    return data as unknown as Plan;
  }

  // The current plan's price + notice, WITHOUT the archived filter — the
  // member is on it, archived or not.
  async function currentPlanTerms(
    planId: string,
  ): Promise<{ monthly_price_cents: number | null; notice_period_days: number | null }> {
    const { data } = await service
      .from('membership_plans')
      .select('monthly_price_cents, notice_period_days')
      .eq('plan_id', planId)
      .maybeSingle();
    return {
      monthly_price_cents: (data?.monthly_price_cents as number | null) ?? null,
      notice_period_days: (data?.notice_period_days as number | null) ?? null,
    };
  }

  function isUpgradeFor(ps: PlanSub, currentListPrice: number | null, target: Plan) {
    const currentPrice = ps.price_cents ?? currentListPrice ?? 0;
    const targetPrice = target.monthly_price_cents ?? 0;
    return targetPrice > currentPrice;
  }

  // Get-or-create the connected-account Price for a plan, cached on the row.
  async function ensurePrice(plan: Plan, account: string): Promise<string> {
    if (plan.stripe_price_id) return plan.stripe_price_id;
    // The gym's currency, not a hardcoded 'gbp' — see the note in
    // stripe-checkout. A Price is immutable once created.
    const { data: gymRow } = await service
      .from('gyms')
      .select('currency')
      .eq('id', plan.gym_id)
      .maybeSingle();
    const currency = ((gymRow?.currency as string | null) ?? 'GBP').toLowerCase();
    const product = await stripePost(
      'products',
      { name: plan.name },
      STRIPE_SECRET_KEY!,
      account,
    );
    const price = await stripePost(
      'prices',
      {
        product: product.id as string,
        currency,
        unit_amount: String(plan.monthly_price_cents ?? 0),
        'recurring[interval]': 'month',
      },
      STRIPE_SECRET_KEY!,
      account,
    );
    const priceId = price.id as string;
    await service
      .from('membership_plans')
      .update({ stripe_price_id: priceId })
      .eq('plan_id', plan.plan_id);
    return priceId;
  }

  // Shared guards for any switch, either direction.
  function switchGuards(ps: PlanSub, target: Plan): Response | null {
    if (target.kind === 'credit_pack') {
      return json({ error: 'A membership cannot switch to a class pack' }, 400);
    }
    if (target.plan_id === ps.plan_id) {
      return json({ error: 'Already on this plan' }, 400);
    }
    if (!ps.stripe_subscription_id) {
      return json({ error: 'This membership is not a recurring subscription' }, 400);
    }
    if (ps.pending_plan_id) {
      return json(
        { error: 'A plan change is already scheduled for this membership' },
        409,
      );
    }
    return null;
  }

  // Upgrade: swap now, pro-rated, charged immediately. error_if_incomplete
  // makes a declined card fail the whole switch — Stripe leaves the
  // subscription on the old price and we never touch the mirror row.
  // price_cents is reset deliberately: the snapshot trigger only fires on
  // insert, and a switch is a real price change the member chose (distinct
  // from the grandfathering invariant).
  async function applyUpgradeNow(
    ps: PlanSub,
    target: Plan,
    account: string,
  ): Promise<Response | null> {
    const guard = switchGuards(ps, target);
    if (guard) return guard;
    const priceId = await ensurePrice(target, account);
    const sub = await stripeGet(
      `subscriptions/${ps.stripe_subscription_id}`,
      STRIPE_SECRET_KEY!,
      account,
    );
    const itemId = (sub.items as { data?: { id?: string }[] } | undefined)?.data?.[0]
      ?.id;
    if (!itemId) {
      return json({ error: 'Could not read the Stripe subscription' }, 502);
    }
    await stripePost(
      `subscriptions/${ps.stripe_subscription_id}`,
      {
        'items[0][id]': itemId,
        'items[0][price]': priceId,
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        'metadata[plan_id]': target.plan_id,
      },
      STRIPE_SECRET_KEY!,
      account,
    );
    const { error } = await service
      .from('plan_subscriptions')
      .update({
        plan_id: target.plan_id,
        price_cents: target.monthly_price_cents,
        credit_balance: target.kind === 'unlimited' ? null : target.credit_count,
      })
      .eq('id', ps.id);
    if (error) throw error;
    return null;
  }

  // Downgrade (or equal-price sideways move): record it, don't apply it.
  // The apply-plan-changes worker performs the swap at the first renewal on
  // or after the notice gate; until then the member keeps the plan they
  // paid for. No Stripe call happens here at all.
  async function scheduleDowngrade(
    ps: PlanSub,
    target: Plan,
    noticeDays: number | null,
  ): Promise<Response | null> {
    const guard = switchGuards(ps, target);
    if (guard) return guard;
    if (ps.status !== 'active') {
      return json({ error: 'Only an active membership can change plan' }, 400);
    }
    const notBefore = new Date(
      Date.now() + Math.max(0, noticeDays ?? 0) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error } = await service
      .from('plan_subscriptions')
      .update({
        pending_plan_id: target.plan_id,
        pending_change_not_before: notBefore,
        pending_change_requested_at: new Date().toISOString(),
      })
      .eq('id', ps.id);
    if (error) throw error;
    return null;
  }

  async function applySwitch(
    ps: PlanSub,
    target: Plan,
    account: string,
  ): Promise<{ fail: Response | null; scheduled: boolean }> {
    const terms = await currentPlanTerms(ps.plan_id);
    if (isUpgradeFor(ps, terms.monthly_price_cents, target)) {
      return { fail: await applyUpgradeNow(ps, target, account), scheduled: false };
    }
    return {
      fail: await scheduleDowngrade(ps, target, terms.notice_period_days),
      scheduled: true,
    };
  }

  // cancel_at_period_end keeps access through the paid period (the notice
  // window the member already sees), then Stripe emits subscription.deleted
  // and the webhook flips the row to cancelled.
  async function applyCancel(
    ps: PlanSub,
    account: string,
  ): Promise<Response | null> {
    if (!ps.stripe_subscription_id) {
      return json({ error: 'This membership is not a recurring subscription' }, 400);
    }
    await stripePost(
      `subscriptions/${ps.stripe_subscription_id}`,
      { cancel_at_period_end: 'true' },
      STRIPE_SECRET_KEY!,
      account,
    );
    const { error } = await service
      .from('plan_subscriptions')
      .update({ status: 'cancelled_at_period_end' })
      .eq('id', ps.id);
    if (error) throw error;
    return null;
  }

  async function loadOwnSub(psId: string): Promise<PlanSub | null> {
    const { data: psRow } = await service
      .from('plan_subscriptions')
      .select(PS_COLUMNS)
      .eq('id', psId)
      .maybeSingle();
    const ps = psRow as PlanSub | null;
    if (!ps || ps.profile_id !== user!.id) return null;
    return ps;
  }

  try {
    // What would this switch do? Direction always; for an upgrade, the
    // exact pro-rated charge from Stripe's own invoice preview — an
    // approximation on a payment sheet is a lie waiting to be screenshot.
    // Preview failures degrade to charge_today_cents: null, and the client
    // says "the difference for the rest of this period" without a number.
    if (body.action === 'preview_switch') {
      const psId = body.plan_subscription_id;
      const targetId = body.target_plan_id;
      if (!psId || !targetId) {
        return json(
          { error: 'plan_subscription_id and target_plan_id are required' },
          400,
        );
      }
      const ps = await loadOwnSub(psId);
      if (!ps) return json({ error: 'Subscription not found' }, 404);
      const target = await loadPlan(targetId, ps.gym_id);
      if (!target) return json({ error: 'Plan not found' }, 404);
      const guard = switchGuards(ps, target);
      if (guard) return guard;

      const terms = await currentPlanTerms(ps.plan_id);
      const upgrade = isUpgradeFor(ps, terms.monthly_price_cents, target);
      if (!upgrade) {
        return json({
          direction: 'downgrade',
          notice_period_days: terms.notice_period_days ?? 0,
          charge_today_cents: null,
        });
      }

      const account = await accountFor(ps.gym_id);
      if (!account) return json({ error: 'This gym has not connected Stripe yet' }, 409);
      let chargeToday: number | null = null;
      let currency: string | null = null;
      try {
        const priceId = await ensurePrice(target, account);
        const sub = await stripeGet(
          `subscriptions/${ps.stripe_subscription_id}`,
          STRIPE_SECRET_KEY!,
          account,
        );
        const itemId = (sub.items as { data?: { id?: string }[] } | undefined)
          ?.data?.[0]?.id;
        if (!itemId) throw new Error('Could not read the Stripe subscription');
        const preview = await stripePost(
          'invoices/create_preview',
          {
            subscription: ps.stripe_subscription_id!,
            'subscription_details[items][0][id]': itemId,
            'subscription_details[items][0][price]': priceId,
            'subscription_details[proration_behavior]': 'always_invoice',
          },
          STRIPE_SECRET_KEY!,
          account,
        );
        const lines =
          (preview.lines as { data?: Record<string, unknown>[] } | undefined)?.data ??
          [];
        chargeToday = lines
          .filter(isProrationLine)
          .reduce((sum, l) => sum + ((l.amount as number) ?? 0), 0);
        currency = (preview.currency as string | undefined) ?? null;
      } catch (e) {
        console.warn('preview_switch: Stripe preview failed', {
          error: String((e as Error)?.message ?? e),
        });
      }
      return json({
        direction: 'upgrade',
        charge_today_cents: chargeToday,
        currency,
      });
    }

    if (body.action === 'self_serve') {
      const psId = body.plan_subscription_id;
      const kind = body.kind;
      if (!psId || (kind !== 'switch_plan' && kind !== 'cancel')) {
        return json({ error: 'plan_subscription_id and a valid kind are required' }, 400);
      }
      const ps = await loadOwnSub(psId);
      if (!ps) return json({ error: 'Subscription not found' }, 404);

      const { data: gym } = await service
        .from('gyms')
        .select(
          'membership_upgrade_policy, membership_downgrade_policy, membership_cancel_policy',
        )
        .eq('id', ps.gym_id)
        .maybeSingle();
      if (!gym) return json({ error: 'Gym not found' }, 404);

      const account = await accountFor(ps.gym_id);
      if (!account) return json({ error: 'This gym has not connected Stripe yet' }, 409);

      if (kind === 'cancel') {
        if (gym.membership_cancel_policy !== 'self_serve') {
          return json(
            { error: 'Cancelling needs staff approval', code: 'needs_approval' },
            403,
          );
        }
        const fail = await applyCancel(ps, account);
        return fail ?? json({ ok: true });
      }

      // switch_plan
      const targetId = body.target_plan_id;
      if (!targetId) return json({ error: 'target_plan_id is required' }, 400);
      const target = await loadPlan(targetId, ps.gym_id);
      if (!target) return json({ error: 'Plan not found' }, 404);

      const terms = await currentPlanTerms(ps.plan_id);
      const isUpgrade = isUpgradeFor(ps, terms.monthly_price_cents, target);
      const policy = isUpgrade
        ? gym.membership_upgrade_policy
        : gym.membership_downgrade_policy;
      if (policy !== 'self_serve') {
        return json(
          {
            error: `${isUpgrade ? 'Upgrading' : 'Downgrading'} needs staff approval`,
            code: 'needs_approval',
          },
          403,
        );
      }
      const result = isUpgrade
        ? { fail: await applyUpgradeNow(ps, target, account), scheduled: false }
        : {
            fail: await scheduleDowngrade(ps, target, terms.notice_period_days),
            scheduled: true,
          };
      return result.fail ?? json({ ok: true, scheduled: result.scheduled });
    }

    if (body.action === 'decide') {
      const reqId = body.request_id;
      const decision = body.decision;
      if (!reqId || (decision !== 'approve' && decision !== 'reject')) {
        return json({ error: 'request_id and a valid decision are required' }, 400);
      }
      const { data: mcrRow } = await service
        .from('membership_change_requests')
        .select(
          'id, gym_id, profile_id, plan_subscription_id, kind, target_plan_id, status',
        )
        .eq('id', reqId)
        .maybeSingle();
      const mcr = mcrRow as
        | {
            id: string;
            gym_id: string;
            plan_subscription_id: string;
            kind: 'switch_plan' | 'cancel';
            target_plan_id: string | null;
            status: string;
          }
        | null;
      if (!mcr) return json({ error: 'Request not found' }, 404);
      if (mcr.status !== 'pending') {
        return json({ error: 'This request has already been decided' }, 409);
      }

      const { data: canAssign } = await caller.rpc('user_can_assign_plan', {
        target_gym_id: mcr.gym_id,
      });
      if (!canAssign) return json({ error: 'Not allowed' }, 403);

      if (decision === 'approve') {
        const account = await accountFor(mcr.gym_id);
        if (!account) {
          return json({ error: 'This gym has not connected Stripe yet' }, 409);
        }
        const { data: psRow } = await service
          .from('plan_subscriptions')
          .select(PS_COLUMNS)
          .eq('id', mcr.plan_subscription_id)
          .maybeSingle();
        const ps = psRow as PlanSub | null;
        if (!ps) return json({ error: 'Subscription no longer exists' }, 404);

        if (mcr.kind === 'cancel') {
          const fail = await applyCancel(ps, account);
          if (fail) return fail;
        } else {
          if (!mcr.target_plan_id) {
            return json({ error: 'Request has no target plan' }, 400);
          }
          const target = await loadPlan(mcr.target_plan_id, mcr.gym_id);
          if (!target) return json({ error: 'Target plan not found' }, 404);
          const { fail } = await applySwitch(ps, target, account);
          if (fail) return fail;
        }
      }

      const { error } = await service
        .from('membership_change_requests')
        .update({
          status: decision === 'approve' ? 'approved' : 'rejected',
          decided_by: user.id,
          decided_at: new Date().toISOString(),
          staff_note: body.staff_note ?? null,
        })
        .eq('id', mcr.id)
        .eq('status', 'pending');
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
