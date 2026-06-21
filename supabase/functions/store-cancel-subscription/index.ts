// Cancel a recurring store subscription at period end. The member (or
// managing staff) keeps the benefit until the paid period ends; Stripe
// stops renewing. We only flip cancel_at_period_end on the connected
// account here — the webhook's customer.subscription.updated event syncs
// the flag (and the eventual deletion) back onto store_subscriptions.
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

  let body: { subscription_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const subId = body.subscription_id;
  if (!subId) return json({ error: 'subscription_id is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401);

  // Read through the caller's RLS: a row comes back only if they own the
  // subscription or manage the store — so a successful read IS the
  // authorisation. No separate gate needed.
  const { data: sub } = await caller
    .from('store_subscriptions')
    .select('id, gym_id, status, stripe_subscription_id')
    .eq('id', subId)
    .maybeSingle();
  if (!sub) return json({ error: 'Subscription not found' }, 404);
  if (sub.status === 'cancelled' || !sub.stripe_subscription_id) {
    return json({ ok: true, alreadyEnded: true });
  }

  const { data: acct } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', sub.gym_id)
    .maybeSingle();
  if (!acct?.stripe_account_id) {
    return json({ error: 'This gym has not connected Stripe' }, 409);
  }

  try {
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          'Stripe-Account': acct.stripe_account_id as string,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString(),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        (data as { error?: { message?: string } })?.error?.message ??
          'Stripe cancel failed',
      );
    }
    // Optimistic local flag; the webhook confirms it shortly.
    await service
      .from('store_subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('id', sub.id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
