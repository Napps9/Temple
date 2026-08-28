// Open Stripe's billing portal for a member's own membership
// subscription, deep-linked straight to the update-your-card flow. This
// is the dunning exit: "we couldn't take your payment" needs somewhere
// for the member to actually fix the card, and the portal is Stripe's
// own hosted form — no card data ever touches Temple.
//
// The portal session runs on the gym's connected account. Connected
// accounts have no default portal configuration until someone creates
// one, so on Stripe's "no configuration" error we create a minimal one
// (payment method update + invoice history) and retry once.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_SECRET_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { DEMO_NO_MONEY, gymIsDemo } from '../_shared/demo.ts';

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

async function stripe(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> | null,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Account': account,
      ...(method === 'POST'
        ? { 'content-type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } })?.error?.message ??
        'Stripe request failed',
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

  let body: { plan_subscription_id?: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const subId = body.plan_subscription_id;
  if (!subId) return json({ error: 'plan_subscription_id is required' }, 400);
  const origin = (body.origin ?? 'https://app.jointemple.io').replace(/\/+$/, '');

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401);

  // Read through the caller's RLS — plan_subscriptions is self-select, so
  // a row coming back means this is the member's own subscription. That
  // read IS the authorisation.
  const { data: sub } = await caller
    .from('plan_subscriptions')
    .select('id, gym_id, stripe_subscription_id')
    .eq('id', subId)
    .maybeSingle();
  if (!sub) return json({ error: 'Subscription not found' }, 404);
  if (!sub.stripe_subscription_id) {
    return json({ error: 'This membership is not billed online' }, 409);
  }

  const { data: acct } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', sub.gym_id)
    .maybeSingle();
  if (!acct?.stripe_account_id) {
    return json({ error: 'This gym has not connected Stripe' }, 409);
  }
  // Reads of a connected account are fine; writes are not. A demo gym
  // keeps its Stripe connection so Billing still looks like a live gym,
  // and this is the line that stops a visitor moving money on it (0278).
  if (await gymIsDemo(service, sub.gym_id)) {
    return json({ error: DEMO_NO_MONEY }, 409);
  }
  const account = acct.stripe_account_id as string;

  try {
    const stripeSub = await stripe(
      'GET',
      `subscriptions/${sub.stripe_subscription_id}`,
      null,
      STRIPE_SECRET_KEY,
      account,
    );
    const customer =
      typeof stripeSub.customer === 'string'
        ? stripeSub.customer
        : (stripeSub.customer as { id?: string } | null)?.id;
    if (!customer) throw new Error('Subscription has no customer');

    const sessionParams: Record<string, string> = {
      customer,
      return_url: `${origin}/membership`,
      'flow_data[type]': 'payment_method_update',
    };

    let session: Record<string, unknown>;
    try {
      session = await stripe(
        'POST',
        'billing_portal/sessions',
        sessionParams,
        STRIPE_SECRET_KEY,
        account,
      );
    } catch (e) {
      if (!/configuration/i.test(String((e as Error)?.message ?? ''))) throw e;
      const config = await stripe(
        'POST',
        'billing_portal/configurations',
        {
          'features[payment_method_update][enabled]': 'true',
          'features[invoice_history][enabled]': 'true',
        },
        STRIPE_SECRET_KEY,
        account,
      );
      session = await stripe(
        'POST',
        'billing_portal/sessions',
        { ...sessionParams, configuration: config.id as string },
        STRIPE_SECRET_KEY,
        account,
      );
    }

    if (!session.url) throw new Error('Portal session has no URL');
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
