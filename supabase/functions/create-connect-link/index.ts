// Phase 1 / Track A: Connect onboarding entrypoint.
//
// Owner-only. Creates the Stripe Connect account if needed, mirrors
// it into stripe_connect_accounts, and returns a Stripe-hosted
// account_link URL the client redirects to.
//
// Subsequent account.updated webhooks (Track A, migration 0027)
// keep the local row's flags in sync as the owner progresses through
// Stripe onboarding.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const refreshUrl =
  Deno.env.get('STRIPE_CONNECT_REFRESH_URL') ?? 'https://temple.app/management/billing';
const returnUrl =
  Deno.env.get('STRIPE_CONNECT_RETURN_URL') ?? 'https://temple.app/management/billing';

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('missing auth', { status: 401, headers: corsHeaders });
  }

  let body: { gymId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('invalid json', { status: 400, headers: corsHeaders });
  }
  const gymId = body.gymId;
  if (typeof gymId !== 'string' || !gymId) {
    return new Response('missing gymId', { status: 400, headers: corsHeaders });
  }

  // Identify the caller via their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders });
  }

  // Verify ownership via service role (RLS bypass).
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: membership, error: memErr } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', userResp.user.id)
    .maybeSingle();
  if (memErr || membership?.role !== 'owner') {
    return new Response('not owner', { status: 403, headers: corsHeaders });
  }

  // Reuse the existing Connect account when present; otherwise create one.
  const { data: existing } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();

  let accountId = existing?.provider_account_id ?? null;

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: 'standard',
        metadata: { gym_id: gymId },
      });
      accountId = account.id;

      const { error: upsertErr } = await supabase
        .from('stripe_connect_accounts')
        .upsert({
          gym_id: gymId,
          provider_account_id: accountId,
          onboarding_status: 'not_started',
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          details_submitted: account.details_submitted ?? false,
          country: account.country ?? null,
          default_currency: account.default_currency ?? null,
          last_synced_at: new Date().toISOString(),
        });
      if (upsertErr) {
        return new Response(`db error: ${upsertErr.message}`, {
          status: 500,
          headers: corsHeaders,
        });
      }

      await supabase.from('audit_events').insert({
        gym_id: gymId,
        actor_profile_id: userResp.user.id,
        subject_kind: 'gym',
        subject_id: gymId,
        kind: 'connect_account_created',
        payload: { stripe_account_id: accountId },
      });
    } catch (err) {
      console.error('stripe account create failed', err);
      return new Response(`stripe: ${(err as Error).message}`, {
        status: 502,
        headers: corsHeaders,
      });
    }
  }

  // Create the onboarding link. account_link is single-use; the client
  // calls this endpoint again on refresh to get a fresh URL.
  let link: Stripe.AccountLink;
  try {
    link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  } catch (err) {
    console.error('stripe account link failed', err);
    return new Response(`stripe: ${(err as Error).message}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  return new Response(
    JSON.stringify({ url: link.url, accountId, expiresAt: link.expires_at }),
    {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    },
  );
});
