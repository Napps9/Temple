// Phase 1 / Track B: refund-payment edge function (§3.5).
//
// Owner-only. Issues the Stripe refund against the most recent
// successful charge on the subscription, then calls the
// refund_payment RPC to update DB state (retain_access toggle
// determines whether status flips to refunded_retained or cancelled).
//
// The eventual charge.refunded webhook records the billing_events
// row and fires the receipt; the RPC deliberately does not insert
// billing_events to avoid double-firing receipts.

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
  amountCents?: number; // null = full refund of the chosen charge
  retainAccess?: boolean;
  chargeId?: string; // optional override — defaults to the latest paid charge
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
  const { planSubscriptionId, retainAccess = true } = body;
  if (!planSubscriptionId) return bad(400, 'missing planSubscriptionId');

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return bad(401, 'unauthorized');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Look up the sub and its gym's Connect account in one round-trip.
  const { data: sub, error: subErr } = await supabase
    .from('plan_subscriptions')
    .select('id, gym_id, stripe_subscription_id, profile_id')
    .eq('id', planSubscriptionId)
    .maybeSingle();
  if (subErr || !sub) return bad(404, 'subscription not found');

  // Owner authorisation — RPC also enforces this, but bail early to
  // avoid hitting Stripe for an unauthorised call.
  const { data: membership } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', sub.gym_id)
    .eq('profile_id', userResp.user.id)
    .maybeSingle();
  if (membership?.role !== 'owner') return bad(403, 'owner only');

  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', sub.gym_id)
    .maybeSingle();
  if (!connect?.provider_account_id) return bad(409, 'no Connect account');
  const accountId = connect.provider_account_id;
  const stripeOpts = { stripeAccount: accountId };

  // Resolve which charge to refund. Caller can override; default to
  // the most recent successful invoice.paid billing_event.
  let chargeId = body.chargeId ?? null;
  if (!chargeId) {
    const { data: lastInvoice } = await supabase
      .from('billing_events')
      .select('payload')
      .eq('plan_subscription_id', planSubscriptionId)
      .eq('kind', 'invoice.paid')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = lastInvoice?.payload as { charge?: string } | undefined;
    chargeId = payload?.charge ?? null;
  }
  if (!chargeId) return bad(409, 'no successful charge found to refund');

  try {
    const refund = await stripe.refunds.create(
      {
        charge: chargeId,
        amount: body.amountCents ?? undefined,
      },
      stripeOpts,
    );

    const refundedAmount = refund.amount ?? 0;

    const { data: rpcResult, error: rpcErr } = await userClient.rpc(
      'refund_payment',
      {
        p_plan_subscription_id: planSubscriptionId,
        p_amount_cents: refundedAmount,
        p_retain_access: retainAccess,
        p_stripe_refund_id: refund.id,
      },
    );
    if (rpcErr) {
      console.error('refund_payment rpc failed after Stripe refund', rpcErr);
      // The refund went through Stripe; surface the DB error but
      // don't pretend it failed. The eventual charge.refunded
      // webhook plus a manual reconcile will fix state.
      return new Response(
        JSON.stringify({
          stripeRefundId: refund.id,
          stripeAmount: refundedAmount,
          dbError: rpcErr.message,
        }),
        {
          status: 207,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    return new Response(
      JSON.stringify({
        stripeRefundId: refund.id,
        amountRefunded: refundedAmount,
        newStatus: row?.new_status ?? null,
        newPaidPeriodEnd: row?.new_paid_period_end ?? null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('stripe refund failed', err);
    return bad(502, `stripe: ${(err as Error).message}`);
  }
});
