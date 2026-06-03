// Phase 1 last-mile: billing-portal edge function (§3.6 path).
//
// Creates a Stripe-hosted Billing Portal session for the member's
// Customer on the gym's Connect account. Members visit the URL to
// update their card, view invoices, and (depending on the gym's
// portal configuration) cancel themselves. The portal is the path of
// least resistance until full in-app Stripe Elements lands.
//
// Self-serve only — staff cannot create a session on a member's
// behalf because the session URL is single-use and tied to the
// session viewer.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const returnUrl =
  Deno.env.get('STRIPE_PORTAL_RETURN_URL') ?? 'https://temple.app/billing';

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
};

type Body = { gymId?: string };

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
  const { gymId } = body;
  if (!gymId) return bad(400, 'missing gymId');

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

  const { data: customer } = await supabase
    .from('stripe_customers')
    .select('customer_id')
    .eq('gym_id', gymId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!customer?.customer_id) return bad(404, 'no Stripe customer');

  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!connect?.provider_account_id) return bad(409, 'no Connect account');

  try {
    const session = await stripe.billingPortal.sessions.create(
      {
        customer: customer.customer_id,
        return_url: returnUrl,
      },
      { stripeAccount: connect.provider_account_id },
    );
    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('billing portal session failed', err);
    return bad(502, `stripe: ${(err as Error).message}`);
  }
});
