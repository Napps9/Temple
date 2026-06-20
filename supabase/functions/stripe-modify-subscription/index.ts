// Stripe billing — change or cancel a membership subscription.
//
// Two callers, one function:
//   action: 'self_serve' — a member changes their OWN subscription, but
//     only where the gym's policy allows it without approval (upgrade /
//     downgrade / cancel each configured self_serve vs request). Filing a
//     request when approval is needed is a plain RLS insert on the client;
//     this path is only the apply.
//   action: 'decide'     — staff with can_assign_plan approve or reject a
//     pending membership_change_request. Approve applies the same change;
//     reject just records the decision.
//
// The Stripe change runs on the gym's connected account as a direct
// charge. Plan switches swap the subscription's price with NO proration
// (proration_behavior=none) — the member keeps their paid period and the
// new price takes effect next cycle. Cancellations set cancel_at_period_end
// so the member keeps access through the period they've paid for.
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
};

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
    action?: 'self_serve' | 'decide';
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
        'plan_id, name, kind, credit_count, monthly_price_cents, stripe_price_id, archived_at',
      )
      .eq('plan_id', planId)
      .eq('gym_id', gymId)
      .maybeSingle();
    if (!data || data.archived_at) return null;
    return data as unknown as Plan;
  }

  // Get-or-create the connected-account Price for a plan, cached on the row.
  async function ensurePrice(plan: Plan, account: string): Promise<string> {
    if (plan.stripe_price_id) return plan.stripe_price_id;
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
        currency: 'gbp',
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

  // Swap the subscription's price with no proration, then mirror the new
  // plan onto plan_subscriptions. price_cents is reset deliberately: the
  // snapshot trigger only fires on insert, and a switch is a real price
  // change the member chose (distinct from the grandfathering invariant).
  async function applySwitch(
    ps: PlanSub,
    target: Plan,
    account: string,
  ): Promise<Response | null> {
    if (target.kind === 'credit_pack') {
      return json({ error: 'A membership cannot switch to a class pack' }, 400);
    }
    if (target.plan_id === ps.plan_id) {
      return json({ error: 'Already on this plan' }, 400);
    }
    if (!ps.stripe_subscription_id) {
      return json({ error: 'This membership is not a recurring subscription' }, 400);
    }
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
        proration_behavior: 'none',
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

  try {
    if (body.action === 'self_serve') {
      const psId = body.plan_subscription_id;
      const kind = body.kind;
      if (!psId || (kind !== 'switch_plan' && kind !== 'cancel')) {
        return json({ error: 'plan_subscription_id and a valid kind are required' }, 400);
      }
      const { data: psRow } = await service
        .from('plan_subscriptions')
        .select(
          'id, gym_id, profile_id, plan_id, status, price_cents, stripe_subscription_id',
        )
        .eq('id', psId)
        .maybeSingle();
      const ps = psRow as PlanSub | null;
      if (!ps || ps.profile_id !== user.id) {
        return json({ error: 'Subscription not found' }, 404);
      }

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

      const { data: current } = await service
        .from('membership_plans')
        .select('monthly_price_cents')
        .eq('plan_id', ps.plan_id)
        .maybeSingle();
      const currentPrice =
        ps.price_cents ?? (current?.monthly_price_cents as number | null) ?? 0;
      const targetPrice = target.monthly_price_cents ?? 0;
      const isUpgrade = targetPrice > currentPrice;
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
      const fail = await applySwitch(ps, target, account);
      return fail ?? json({ ok: true });
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
          .select(
            'id, gym_id, profile_id, plan_id, status, price_cents, stripe_subscription_id',
          )
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
          const fail = await applySwitch(ps, target, account);
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
