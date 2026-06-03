// Phase 1 last-mile: create-checkout-session edge function.
//
// Signup path that sidesteps Stripe Elements entirely. The member
// picks a plan in-app, this function creates a Stripe Checkout
// Session on the gym's Connect account with subscription_data
// carrying gym_id / plan_id / profile_id in metadata, returns the
// URL, and the client redirects. Stripe handles card capture, SCA,
// and Subscription creation.
//
// On completion, Stripe fires checkout.session.completed → the
// webhook reads the metadata, calls signup_member to write the
// plan_subscriptions row, and the existing invoice.paid handler
// flips pending → active. discountCode, if present, is passed as a
// Stripe Promotion Code on the Session.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const successUrl =
  Deno.env.get('STRIPE_CHECKOUT_SUCCESS_URL') ?? 'https://temple.app/billing';
const cancelUrl =
  Deno.env.get('STRIPE_CHECKOUT_CANCEL_URL') ?? 'https://temple.app/signup';

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
  planId?: string;
  discountCode?: string;
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
  const { gymId, planId } = body;
  if (!gymId || !planId) return bad(400, 'missing gymId or planId');

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return bad(401, 'unauthorized');
  const profileId = userResp.user.id;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // The member must already be at the gym (joined via invite earlier).
  const { data: membership } = await supabase
    .from('gym_memberships')
    .select('id')
    .eq('gym_id', gymId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!membership) return bad(403, 'not at this gym');

  const [{ data: plan }, { data: connect }] = await Promise.all([
    supabase
      .from('membership_plans')
      .select('plan_id, stripe_price_id')
      .eq('plan_id', planId)
      .eq('gym_id', gymId)
      .maybeSingle(),
    supabase
      .from('stripe_connect_accounts')
      .select('provider_account_id, charges_enabled')
      .eq('gym_id', gymId)
      .maybeSingle(),
  ]);
  if (!plan?.stripe_price_id) return bad(409, 'plan not mirrored to Stripe yet');
  if (!connect?.provider_account_id || !connect.charges_enabled) {
    return bad(409, 'gym has not finished Stripe onboarding');
  }
  const accountId = connect.provider_account_id;

  // Reuse the existing Customer if we have one on this Connect
  // account; Checkout will create one otherwise.
  const { data: existingCustomer } = await supabase
    .from('stripe_customers')
    .select('customer_id')
    .eq('gym_id', gymId)
    .eq('profile_id', profileId)
    .maybeSingle();

  // Resolve a promotion_code id from a code string, if supplied.
  let promotionCodeId: string | null = null;
  if (body.discountCode) {
    try {
      const promos = await stripe.promotionCodes.list(
        { code: body.discountCode, active: true, limit: 1 },
        { stripeAccount: accountId },
      );
      promotionCodeId = promos.data[0]?.id ?? null;
    } catch (err) {
      console.warn('promo lookup failed', err);
    }
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        customer: existingCustomer?.customer_id ?? undefined,
        customer_email: existingCustomer ? undefined : userResp.user.email ?? undefined,
        success_url: `${successUrl}?signup=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        discounts: promotionCodeId ? [{ promotion_code: promotionCodeId }] : undefined,
        allow_promotion_codes: promotionCodeId ? undefined : true,
        subscription_data: {
          metadata: {
            gym_id: gymId,
            profile_id: profileId,
            plan_id: planId,
          },
        },
      },
      { stripeAccount: accountId },
    );

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('checkout session creation failed', err);
    return bad(502, `stripe: ${(err as Error).message}`);
  }
});
