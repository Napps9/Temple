// Phase 1 last-mile: change-plan edge function (§3.2).
//
// Wraps the change_plan RPC with the Stripe side. Stripe handles
// the proration math — immediate charge for an upgrade, credit on
// next bill for a downgrade — via proration_behavior =
// 'create_prorations'. The RPC swaps plan_id in the DB and emits
// audit; this function tells Stripe to swap the Price item too.
//
// affected_bookings is read first via get_affected_bookings_on_plan_change
// and returned to the caller; the UI surfaces it and the member
// confirms before this function fires.

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

type Body = {
  planSubscriptionId?: string;
  newPlanId?: string;
};

function bad(status: number, msg: string) {
  return new Response(msg, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return bad(405, 'method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return bad(401, 'missing auth');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid json');
  }
  const { planSubscriptionId, newPlanId } = body;
  if (!planSubscriptionId || !newPlanId) {
    return bad(400, 'missing planSubscriptionId or newPlanId');
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Resolve sub + new plan + connect account before touching Stripe.
  const { data: sub } = await supabase
    .from('plan_subscriptions')
    .select('id, gym_id, stripe_subscription_id')
    .eq('id', planSubscriptionId)
    .maybeSingle();
  if (!sub) return bad(404, 'subscription not found');

  const { data: newPlan } = await supabase
    .from('membership_plans')
    .select('plan_id, gym_id, stripe_price_id')
    .eq('plan_id', newPlanId)
    .maybeSingle();
  if (!newPlan || newPlan.gym_id !== sub.gym_id) {
    return bad(404, 'new plan not found at this gym');
  }
  if (!newPlan.stripe_price_id) {
    return bad(409, 'new plan not mirrored to Stripe yet');
  }

  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', sub.gym_id)
    .maybeSingle();
  const stripeOpts = connect?.provider_account_id
    ? { stripeAccount: connect.provider_account_id }
    : undefined;

  // Update Stripe first; if that fails, the RPC isn't called and
  // DB stays in sync with Stripe.
  if (sub.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        sub.stripe_subscription_id,
        stripeOpts,
      );
      const itemId = stripeSub.items.data[0]?.id;
      if (!itemId) {
        return bad(500, 'no subscription item to update');
      }
      await stripe.subscriptions.update(
        sub.stripe_subscription_id,
        {
          items: [{ id: itemId, price: newPlan.stripe_price_id }],
          proration_behavior: 'create_prorations',
        },
        stripeOpts,
      );
    } catch (err) {
      console.error('stripe price swap failed', err);
      return bad(502, `stripe: ${(err as Error).message}`);
    }
  }

  // Call the RPC under the caller's JWT so its auth checks run as
  // the right user.
  const { data: rpcResult, error: rpcErr } = await userClient.rpc('change_plan', {
    p_plan_subscription_id: planSubscriptionId,
    p_new_plan_id: newPlanId,
  });
  if (rpcErr) {
    console.error('change_plan RPC failed after Stripe swap', rpcErr);
    return new Response(
      JSON.stringify({ stripeOk: true, dbError: rpcErr.message }),
      {
        status: 207,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  }

  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  return new Response(JSON.stringify(row ?? {}), {
    status: 200,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
});
