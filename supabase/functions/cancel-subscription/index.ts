// Phase 1 / Track B: cancel-subscription edge function.
//
// Wraps the cancel_subscription RPC with the Stripe side. The RPC
// owns the math (notice-period boundary rounding) and writes the
// DB state; this function reads the result back and tells Stripe:
//
//   active → cancelled_at_period_end
//     stripe.subscriptions.update(cancel_at = new_paid_period_end)
//     Stripe charges renewals normally up to cancel_at, then cancels.
//
//   paused → cancelled (terminal)
//     stripe.subscriptions.cancel(...)
//     Pause already held billing; cancel immediately.
//
// Auth: self-cancel or staff. The RPC re-checks ownership so even if
// the edge function is bypassed, the DB enforces it.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
};

type Body = { planSubscriptionId?: string };

function bad(status: number, msg: string) {
  return new Response(msg, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') return bad(405, 'method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return bad(401, 'missing auth');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid json');
  }
  const planSubscriptionId = body.planSubscriptionId;
  if (!planSubscriptionId) return bad(400, 'missing planSubscriptionId');

  // Call the RPC under the caller's JWT so its auth checks run as
  // the right user — the RPC enforces self-or-staff via
  // user_can_assign_plan, and we want that enforcement honoured.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: rpcResult, error: rpcErr } = await userClient.rpc(
    'cancel_subscription',
    { p_plan_subscription_id: planSubscriptionId },
  );
  if (rpcErr) {
    console.error('cancel_subscription rpc failed', rpcErr);
    return bad(403, rpcErr.message);
  }

  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  if (!row) return bad(500, 'rpc returned no row');
  const newStatus = row.new_status as
    | 'cancelled_at_period_end'
    | 'cancelled';
  const newPaidPeriodEnd = row.new_paid_period_end as string | null;

  // Now look up the Stripe-side identifiers (under service role so we
  // can read the Connect account too).
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: sub, error: subErr } = await supabase
    .from('plan_subscriptions')
    .select('stripe_subscription_id, gym_id')
    .eq('id', planSubscriptionId)
    .maybeSingle();
  if (subErr || !sub) {
    console.error('failed to read plan_subscriptions after cancel', subErr);
    return bad(500, 'db lookup failed');
  }
  if (!sub.stripe_subscription_id) {
    // No Stripe sub to cancel — RPC already wrote DB state.
    return new Response(JSON.stringify({ newStatus, newPaidPeriodEnd }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', sub.gym_id)
    .maybeSingle();
  const accountId = connect?.provider_account_id ?? null;
  const stripeOpts = accountId ? { stripeAccount: accountId } : undefined;

  try {
    if (newStatus === 'cancelled_at_period_end' && newPaidPeriodEnd) {
      const cancelAt = Math.floor(new Date(newPaidPeriodEnd).getTime() / 1000);
      await stripe.subscriptions.update(
        sub.stripe_subscription_id,
        { cancel_at: cancelAt, proration_behavior: 'none' },
        stripeOpts,
      );
    } else if (newStatus === 'cancelled') {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id, stripeOpts);
    }
  } catch (err) {
    console.error('stripe cancel sync failed', err);
    // DB is already updated; surface the Stripe error but don't
    // unwind. The next customer.subscription.updated webhook (or
    // manual retry) will reconcile.
    return new Response(
      JSON.stringify({
        newStatus,
        newPaidPeriodEnd,
        stripeError: (err as Error).message,
      }),
      {
        status: 207,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  }

  return new Response(JSON.stringify({ newStatus, newPaidPeriodEnd }), {
    status: 200,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
});
