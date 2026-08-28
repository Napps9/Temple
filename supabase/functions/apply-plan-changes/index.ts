// Applies scheduled plan downgrades at the renewal they land on.
//
// A downgrade never takes effect mid-cycle: stripe-modify-subscription
// records it as pending_plan_id (+ pending_change_not_before, the notice
// gate) on the subscription row, and this worker performs the actual Stripe
// price swap in the 45-minute window BEFORE the renewal — the swap has to
// precede Stripe's invoice creation, or the renewal bills the old price.
// The dispatch-plan-changes cron (every 15 min) pokes this function only
// when something is due.
//
// The swap itself is proration_behavior=none on purpose: it lands at the
// period boundary, so there is nothing to prorate — the old price covered
// the old period, the renewal bills the new one.
//
// Rows that can no longer proceed clear their pending state instead of
// retrying forever: a subscription that is no longer active (cancelled,
// paused) keeps the plan it has, and a target plan archived since the
// member chose it is dropped with a warning — staff assign something else.
//
// Auth mirrors send-email-automations: the cron's x-automation-secret, or
// the service-role key. Neither is "anyone".
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//               AUTOMATION_WORKER_SECRET (must equal the
//               app.automation_worker_secret GUC the dispatcher sends)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { DEMO_NO_MONEY, gymIsDemo } from '../_shared/demo.ts';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-automation-secret',
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

type DueRow = {
  id: string;
  gym_id: string;
  plan_id: string;
  status: string;
  stripe_subscription_id: string;
  pending_plan_id: string;
  paid_period_end: string;
  pending_change_not_before: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured yet' }, 503);
  }

  const secret = Deno.env.get('AUTOMATION_WORKER_SECRET');
  const authorised =
    req.headers.get('Authorization') === `Bearer ${SERVICE_KEY}` ||
    (!!secret && req.headers.get('x-automation-secret') === secret);
  if (!authorised) return json({ error: 'Not authorised' }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // Same due window as dispatch_plan_changes(), minus two predicates that
  // move into the loop: the notice gate compares two columns (which
  // PostgREST filters cannot), and rows whose subscription is no longer
  // active are wanted here anyway, so their stale pending state can be
  // cleared rather than left to trip a future cycle.
  const { data: rows, error } = await service
    .from('plan_subscriptions')
    .select(
      'id, gym_id, plan_id, status, stripe_subscription_id, pending_plan_id, paid_period_end, pending_change_not_before',
    )
    .not('pending_plan_id', 'is', null)
    .not('stripe_subscription_id', 'is', null)
    .not('paid_period_end', 'is', null)
    .lte('paid_period_end', new Date(Date.now() + 45 * 60 * 1000).toISOString());
  if (error) return json({ error: error.message }, 500);

  let applied = 0;
  let cleared = 0;
  let failed = 0;

  for (const row of (rows ?? []) as DueRow[]) {
    try {
      const clearPending = {
        pending_plan_id: null,
        pending_change_not_before: null,
        pending_change_requested_at: null,
      };

      if (row.status !== 'active') {
        await service.from('plan_subscriptions').update(clearPending).eq('id', row.id);
        cleared += 1;
        continue;
      }

      // Notice gate: this renewal is inside the notice window, so the
      // change waits for the next one. Skip without clearing — the row
      // becomes due when the webhook advances paid_period_end.
      if (
        row.pending_change_not_before &&
        new Date(row.paid_period_end) < new Date(row.pending_change_not_before)
      ) {
        continue;
      }

      const { data: target } = await service
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, monthly_price_cents, stripe_price_id, archived_at',
        )
        .eq('plan_id', row.pending_plan_id)
        .eq('gym_id', row.gym_id)
        .maybeSingle();
      if (!target || target.archived_at || target.kind === 'credit_pack') {
        console.warn('apply-plan-changes: target plan gone, clearing pending', {
          subscription: row.id,
          target: row.pending_plan_id,
        });
        await service.from('plan_subscriptions').update(clearPending).eq('id', row.id);
        cleared += 1;
        continue;
      }

      const { data: acct } = await service
        .from('gym_stripe_accounts')
        .select('stripe_account_id')
        .eq('gym_id', row.gym_id)
        .maybeSingle();
      const account = acct?.stripe_account_id as string | undefined;
      if (!account) throw new Error('Gym has no Stripe account');
      // Reads of a connected account are fine; writes are not. A demo gym
      // keeps its Stripe connection so Billing still looks like a live gym,
      // and this is the line that stops a visitor moving money on it (0278).
      if (await gymIsDemo(service, row.gym_id)) throw new Error(DEMO_NO_MONEY);

      let priceId = target.stripe_price_id as string | null;
      if (!priceId) {
        // The gym's currency, not a hardcoded 'gbp' — see the note in
        // stripe-checkout. A Price is immutable once created, so the
        // wrong currency here is permanent for that plan.
        const { data: gymRow } = await service
          .from('gyms')
          .select('currency')
          .eq('id', row.gym_id)
          .maybeSingle();
        const currency = ((gymRow?.currency as string | null) ?? 'GBP').toLowerCase();
        const product = await stripePost(
          'products',
          { name: target.name as string },
          STRIPE_SECRET_KEY,
          account,
        );
        const price = await stripePost(
          'prices',
          {
            product: product.id as string,
            currency,
            unit_amount: String(target.monthly_price_cents ?? 0),
            'recurring[interval]': 'month',
          },
          STRIPE_SECRET_KEY,
          account,
        );
        priceId = price.id as string;
        await service
          .from('membership_plans')
          .update({ stripe_price_id: priceId })
          .eq('plan_id', target.plan_id);
      }

      const sub = await stripeGet(
        `subscriptions/${row.stripe_subscription_id}`,
        STRIPE_SECRET_KEY,
        account,
      );
      const itemId = (sub.items as { data?: { id?: string }[] } | undefined)
        ?.data?.[0]?.id;
      if (!itemId) throw new Error('Could not read the Stripe subscription');

      await stripePost(
        `subscriptions/${row.stripe_subscription_id}`,
        {
          'items[0][id]': itemId,
          'items[0][price]': priceId,
          proration_behavior: 'none',
          'metadata[plan_id]': target.plan_id as string,
        },
        STRIPE_SECRET_KEY,
        account,
      );

      const { error: upErr } = await service
        .from('plan_subscriptions')
        .update({
          plan_id: target.plan_id,
          price_cents: target.monthly_price_cents,
          credit_balance:
            target.kind === 'unlimited' ? null : (target.credit_count as number | null),
          ...clearPending,
        })
        .eq('id', row.id);
      if (upErr) throw upErr;
      applied += 1;
    } catch (e) {
      failed += 1;
      console.warn('apply-plan-changes: row failed, will retry next tick', {
        subscription: row.id,
        error: String((e as Error)?.message ?? e),
      });
    }
  }

  return json({ ok: true, applied, cleared, failed, seen: rows?.length ?? 0 });
});
