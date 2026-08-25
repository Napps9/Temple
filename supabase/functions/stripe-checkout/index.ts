// Stripe billing Phase 2 — start a Checkout for a plan. Runs a direct
// charge on the gym's connected account (no platform fee): gets or
// creates the Stripe Customer + Price for the plan, then opens a Checkout
// Session — subscription mode for recurring plans (unlimited /
// credit_period), one-off payment for credit packs. The session carries
// gym/plan/profile metadata so the webhook can record the result.
//
// Member self-serve: the caller pays for their own membership. (A staff
// "charge this member" path will reuse the same session creation.)
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

// POST form-encoded to the Stripe API on behalf of a connected account
// (the Stripe-Account header = a direct charge). Throws on a Stripe error.
async function stripe(
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
    gym_id?: string;
    plan_id?: string;
    origin?: string;
    success_path?: string;
    legacy_subscription_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const planId = body.plan_id;
  const origin = (body.origin ?? 'https://app.jointemple.io').replace(/\/+$/, '');
  const legacySubscriptionId = body.legacy_subscription_id;
  // Optional client return path. Must be relative (leading slash, no
  // scheme) so it can't be turned into an open redirect; defaults to the
  // membership landing the app root already handles.
  const successPath =
    typeof body.success_path === 'string' &&
    body.success_path.startsWith('/') &&
    !body.success_path.startsWith('//')
      ? body.success_path
      : '/?checkout=success';
  if (!gymId || !planId) {
    return json({ error: 'gym_id and plan_id are required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  // Caller must be an active member of the gym they're paying.
  const { data: mem } = await caller
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', user.id)
    .is('left_at', null)
    .maybeSingle();
  if (!mem) return json({ error: 'Not a member of this gym' }, 403);

  const { data: acct } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!acct?.stripe_account_id) {
    return json({ error: 'This gym has not connected Stripe yet' }, 409);
  }
  const account = acct.stripe_account_id as string;

  const { data: plan } = await service
    .from('membership_plans')
    .select('plan_id, name, kind, monthly_price_cents, stripe_price_id, archived_at')
    .eq('plan_id', planId)
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!plan || plan.archived_at) return json({ error: 'Plan not found' }, 404);

  // Continuing a legacy import onto real billing: verify the row is
  // actually this caller's own unbilled legacy subscription for this
  // plan before minting metadata that tells the webhook to convert it
  // in place instead of inserting a second, duplicate row.
  let legacySubId: string | null = null;
  if (legacySubscriptionId) {
    const { data: legacy } = await service
      .from('plan_subscriptions')
      .select('id')
      .eq('id', legacySubscriptionId)
      .eq('gym_id', gymId)
      .eq('profile_id', user.id)
      .eq('plan_id', planId)
      .eq('imported_legacy', true)
      .eq('status', 'active')
      .maybeSingle();
    if (!legacy) {
      return json({ error: 'That legacy membership could not be found' }, 404);
    }
    legacySubId = legacy.id as string;
  }

  // Credit packs are a one-off purchase; everything else bills monthly.
  const recurring = plan.kind !== 'credit_pack';

  // The gym's own currency, not a hardcoded 'gbp'. gyms.currency has
  // existed since 0027 and the app renders every price with it, so a
  // euro gym has been reading euros on screen and having its Stripe
  // Price created in pounds. Cached prices predating this keep the
  // currency they were created with — Stripe prices are immutable —
  // so a gym that was billing in the wrong one needs its
  // membership_plans.stripe_price_id cleared to re-mint.
  const { data: gymRow } = await service
    .from('gyms')
    .select('currency')
    .eq('id', gymId)
    .maybeSingle();
  const currency = ((gymRow?.currency as string | null) ?? 'GBP').toLowerCase();

  try {
    // 1. Customer on the connected account, reused across checkouts.
    let customerId: string;
    const { data: existing } = await service
      .from('gym_stripe_customers')
      .select('stripe_customer_id')
      .eq('gym_id', gymId)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (existing?.stripe_customer_id) {
      customerId = existing.stripe_customer_id as string;
    } else {
      const cust = await stripe(
        'customers',
        {
          email: user.email ?? '',
          'metadata[gym_id]': gymId,
          'metadata[profile_id]': user.id,
        },
        STRIPE_SECRET_KEY,
        account,
      );
      customerId = cust.id as string;
      await service.from('gym_stripe_customers').upsert({
        gym_id: gymId,
        profile_id: user.id,
        stripe_customer_id: customerId,
      });
    }

    // 2. Price for the plan, created lazily and cached on the plan.
    let priceId = plan.stripe_price_id as string | null;
    if (!priceId) {
      const product = await stripe(
        'products',
        { name: plan.name as string },
        STRIPE_SECRET_KEY,
        account,
      );
      const priceParams: Record<string, string> = {
        product: product.id as string,
        currency,
        unit_amount: String(plan.monthly_price_cents),
      };
      if (recurring) priceParams['recurring[interval]'] = 'month';
      const price = await stripe('prices', priceParams, STRIPE_SECRET_KEY, account);
      priceId = price.id as string;
      await service
        .from('membership_plans')
        .update({ stripe_price_id: priceId })
        .eq('plan_id', planId);
    }

    // 3. Checkout session. Metadata is mirrored onto the subscription /
    //    payment intent so the webhook can map the result back.
    const sessionParams: Record<string, string> = {
      mode: recurring ? 'subscription' : 'payment',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      'metadata[gym_id]': gymId,
      'metadata[plan_id]': planId,
      'metadata[profile_id]': user.id,
    };
    if (legacySubId) sessionParams['metadata[legacy_subscription_id]'] = legacySubId;
    const metaPrefix = recurring
      ? 'subscription_data[metadata]'
      : 'payment_intent_data[metadata]';
    sessionParams[`${metaPrefix}[gym_id]`] = gymId;
    sessionParams[`${metaPrefix}[plan_id]`] = planId;
    sessionParams[`${metaPrefix}[profile_id]`] = user.id;
    if (legacySubId) sessionParams[`${metaPrefix}[legacy_subscription_id]`] = legacySubId;

    const session = await stripe(
      'checkout/sessions',
      sessionParams,
      STRIPE_SECRET_KEY,
      account,
    );
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
