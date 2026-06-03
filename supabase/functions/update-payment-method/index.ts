// Phase 1 / Track B: update-payment-method edge function (§3.6).
//
// Self-serve card update for members. Staff can update on behalf
// of a member at a gym they admin (rare, but matches how staff
// can intervene on the member's billing for cover / migration).
//
// No SQL RPC: this is a thin wrapper over Stripe + a single column
// write on stripe_customers. The webhook on payment_method.attached
// would also catch external changes (e.g. members updating cards
// from the Stripe customer portal), but the explicit in-app flow
// uses this endpoint and writes through atomically.

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
  gymId?: string;
  profileId?: string;
  paymentMethodId?: string;
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
  const { gymId, paymentMethodId } = body;
  if (!gymId || !paymentMethodId) return bad(400, 'missing gymId or paymentMethodId');

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return bad(401, 'unauthorized');
  const actorId = userResp.user.id;
  const targetProfileId = body.profileId ?? actorId;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Auth: self or staff at the gym.
  const { data: actorMembership } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', actorId)
    .maybeSingle();
  if (!actorMembership) return bad(403, 'caller not at this gym');
  const isStaff = ['owner', 'coach', 'staff'].includes(actorMembership.role);
  if (targetProfileId !== actorId && !isStaff) {
    return bad(403, 'not authorised to change another member\'s card');
  }

  const { data: customer } = await supabase
    .from('stripe_customers')
    .select('customer_id')
    .eq('gym_id', gymId)
    .eq('profile_id', targetProfileId)
    .maybeSingle();
  if (!customer?.customer_id) return bad(404, 'no Stripe customer');

  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!connect?.provider_account_id) return bad(409, 'no Connect account');
  const stripeOpts = { stripeAccount: connect.provider_account_id };

  try {
    await stripe.paymentMethods.attach(
      paymentMethodId,
      { customer: customer.customer_id },
      stripeOpts,
    );
    await stripe.customers.update(
      customer.customer_id,
      { invoice_settings: { default_payment_method: paymentMethodId } },
      stripeOpts,
    );

    const { error: dbErr } = await supabase
      .from('stripe_customers')
      .update({
        default_payment_method_id: paymentMethodId,
        last_synced_at: new Date().toISOString(),
      })
      .eq('gym_id', gymId)
      .eq('profile_id', targetProfileId);
    if (dbErr) {
      console.error('stripe_customers update failed after Stripe attach', dbErr);
      // Stripe already has the new card; the next webhook reconciles.
    }

    // Audit
    await supabase.from('audit_events').insert({
      gym_id: gymId,
      actor_profile_id: actorId,
      subject_kind: 'member',
      subject_id: targetProfileId,
      kind: 'payment_method_updated',
      payload: {
        payment_method_id: paymentMethodId,
        self_initiated: targetProfileId === actorId,
      },
    });

    return new Response(JSON.stringify({ ok: true, paymentMethodId }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('update-payment-method failed', err);
    return bad(502, `stripe: ${(err as Error).message}`);
  }
});
