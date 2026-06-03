// Phase 1 / Track B: signup-member edge function.
//
// Wraps the signup_member RPC with the Stripe side of the flow:
//
//   1. Auth — caller must be the member self-signing-up at a gym
//      they already belong to, OR staff (user_can_assign_plan).
//   2. Look up the plan and the gym's Connect account.
//   3. Get-or-create the Stripe Customer on the connected account.
//   4. Attach the supplied PaymentMethod and set it as default.
//   5. Create the Stripe Subscription (with trial_end for scheduled
//      future-dated signups so Stripe fires invoice.paid at the
//      start date).
//   6. Call signup_member RPC, which writes plan_subscriptions in
//      'pending' or 'scheduled' state and seeds stripe_customers.
//
// Webhook handlers then drive the state forward as invoice.paid /
// payment_failed / action_required arrive.

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
  planId?: string;
  paymentMethodId?: string;
  startsAt?: string;
  discountCode?: string;
};

function bad(status: number, msg: string) {
  return new Response(msg, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return bad(405, 'method not allowed');
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return bad(401, 'missing auth');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid json');
  }
  const { gymId, planId, paymentMethodId } = body;
  if (!gymId || !planId || !paymentMethodId) {
    return bad(400, 'missing gymId, planId, or paymentMethodId');
  }

  // Identify the caller.
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

  // Authorisation. Self-signup is OK if caller has a gym_memberships
  // row; staff signup requires user_can_assign_plan via role check.
  const { data: actorMembership } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', actorId)
    .maybeSingle();
  if (!actorMembership) return bad(403, 'caller not at this gym');
  const isStaff = ['owner', 'coach', 'staff'].includes(actorMembership.role);
  if (targetProfileId !== actorId && !isStaff) {
    return bad(403, 'not authorised to sign up another member');
  }

  // Plan + Connect account + target member profile lookups.
  const [{ data: plan }, { data: connect }, { data: profile }] = await Promise.all([
    supabase
      .from('membership_plans')
      .select('plan_id, gym_id, stripe_price_id, name')
      .eq('plan_id', planId)
      .maybeSingle(),
    supabase
      .from('stripe_connect_accounts')
      .select('provider_account_id, charges_enabled')
      .eq('gym_id', gymId)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', targetProfileId)
      .maybeSingle(),
  ]);

  if (!plan || plan.gym_id !== gymId) return bad(404, 'plan not found');
  if (!plan.stripe_price_id) return bad(409, 'plan not mirrored to Stripe yet');
  if (!connect?.provider_account_id || !connect.charges_enabled) {
    return bad(409, 'gym has not finished Stripe onboarding');
  }
  const accountId = connect.provider_account_id;

  // Get-or-create Stripe Customer on the connected account.
  let customerId: string | null = null;
  const { data: existingCustomer } = await supabase
    .from('stripe_customers')
    .select('customer_id')
    .eq('gym_id', gymId)
    .eq('profile_id', targetProfileId)
    .maybeSingle();
  customerId = existingCustomer?.customer_id ?? null;

  try {
    if (!customerId) {
      const { data: targetUser } = await userClient.auth.admin.getUserById(targetProfileId).catch(
        () => ({ data: null as { user: { email?: string } | null } | null }),
      );
      const customer = await stripe.customers.create(
        {
          name: profile?.full_name ?? undefined,
          email: targetUser?.user?.email ?? undefined,
          metadata: { gym_id: gymId, profile_id: targetProfileId },
        },
        { stripeAccount: accountId },
      );
      customerId = customer.id;
    }

    await stripe.paymentMethods.attach(
      paymentMethodId,
      { customer: customerId },
      { stripeAccount: accountId },
    );
    await stripe.customers.update(
      customerId,
      { invoice_settings: { default_payment_method: paymentMethodId } },
      { stripeAccount: accountId },
    );

    const isScheduled = body.startsAt && new Date(body.startsAt).getTime() > Date.now();
    const trialEnd = isScheduled
      ? Math.floor(new Date(body.startsAt!).getTime() / 1000)
      : undefined;

    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: plan.stripe_price_id }],
        trial_end: trialEnd,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          gym_id: gymId,
          profile_id: targetProfileId,
          plan_id: planId,
        },
      },
      { stripeAccount: accountId },
    );

    const recurring = subscription.items.data[0]?.price?.recurring;
    const billingInterval = recurring?.interval
      ? `${recurring.interval_count ?? 1} ${recurring.interval}`
      : null;

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('signup_member', {
      p_gym_id: gymId,
      p_profile_id: targetProfileId,
      p_plan_id: planId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_billing_interval: billingInterval,
      p_paid_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      p_starts_at: body.startsAt ?? null,
    });
    if (rpcErr) {
      console.error('signup_member rpc failed', rpcErr);
      return bad(500, `db: ${rpcErr.message}`);
    }

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;
    const paymentIntent = latestInvoice?.payment_intent as Stripe.PaymentIntent | null;

    return new Response(
      JSON.stringify({
        planSubscription: rpcResult,
        stripeSubscriptionId: subscription.id,
        clientSecret: paymentIntent?.client_secret ?? null,
        status: subscription.status,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('signup-member failed', err);
    return bad(502, `stripe: ${(err as Error).message}`);
  }
});
