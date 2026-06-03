// Phase 1 last-mile: save-plan edge function.
//
// Owner-only. Upserts a membership_plans row AND mirrors it into
// the gym's Stripe Connect account as a Product + Price. Stripe
// Prices are immutable, so a price change creates a fresh Price and
// rewrites stripe_price_id — old Price stays around to honour
// existing subscriptions.
//
// For credit_pack (one-off purchase), the Stripe Price is one_time;
// for unlimited / credit_period, it's recurring on the billingInterval
// supplied by the caller. billing_interval lives on the Stripe price,
// not on membership_plans — Stripe is authoritative.

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

type Kind = 'unlimited' | 'credit_period' | 'credit_pack';
type BillingInterval = { interval: 'day' | 'week' | 'month' | 'year'; intervalCount: number };

type Body = {
  planId?: string; // null = create
  gymId?: string;
  name?: string;
  kind?: Kind;
  creditCount?: number | null;
  periodLength?: string | null; // ISO interval-ish, e.g. "7 days"
  monthlyPriceCents?: number | null;
  noticePeriod?: string | null; // "30 days"
  billing?: BillingInterval | null; // required for recurring
  classTypeIds?: string[]; // allowlist; empty = all
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
  const { gymId, name, kind } = body;
  if (!gymId || !name?.trim() || !kind) return bad(400, 'missing required fields');

  // Per the 0008 CHECK: unlimited has no credit_count/period; credit_period
  // has both; credit_pack has credit_count only.
  if (kind === 'unlimited') {
    if (body.creditCount != null || body.periodLength != null) {
      return bad(400, 'unlimited plans cannot carry credit_count or period_length');
    }
  } else if (kind === 'credit_period') {
    if (!body.creditCount || !body.periodLength) {
      return bad(400, 'credit_period plans need credit_count and period_length');
    }
  } else if (kind === 'credit_pack') {
    if (!body.creditCount) return bad(400, 'credit_pack plans need credit_count');
    if (body.periodLength) return bad(400, 'credit_pack plans cannot carry period_length');
  }

  if ((kind === 'unlimited' || kind === 'credit_period') && !body.billing) {
    return bad(400, 'recurring plans need a billing interval');
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return bad(401, 'unauthorized');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: membership } = await supabase
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', userResp.user.id)
    .maybeSingle();
  if (membership?.role !== 'owner') return bad(403, 'owner only');

  // Existing row?
  let existingPlan: {
    plan_id: string;
    stripe_product_id: string | null;
    stripe_price_id: string | null;
    monthly_price_cents: number | null;
    name: string;
  } | null = null;
  if (body.planId) {
    const { data: existing } = await supabase
      .from('membership_plans')
      .select('plan_id, stripe_product_id, stripe_price_id, monthly_price_cents, name')
      .eq('plan_id', body.planId)
      .eq('gym_id', gymId)
      .maybeSingle();
    existingPlan = existing as typeof existingPlan;
    if (!existingPlan) return bad(404, 'plan not found');
  }

  // Upsert DB first so we have a plan_id to put into Stripe metadata.
  const dbPayload = {
    gym_id: gymId,
    name: name.trim(),
    kind,
    credit_count: body.creditCount ?? null,
    period_length: body.periodLength ?? null,
    monthly_price_cents: body.monthlyPriceCents ?? null,
    notice_period: body.noticePeriod ?? '0',
  };

  let planId: string;
  if (existingPlan) {
    const { error } = await supabase
      .from('membership_plans')
      .update(dbPayload)
      .eq('plan_id', existingPlan.plan_id);
    if (error) return bad(500, `db: ${error.message}`);
    planId = existingPlan.plan_id;
  } else {
    const { data, error } = await supabase
      .from('membership_plans')
      .insert(dbPayload)
      .select('plan_id')
      .single();
    if (error) return bad(500, `db: ${error.message}`);
    planId = data.plan_id;
  }

  // Replace allowlist (only for credit-typed plans; unlimited can
  // carry one too if the gym wants).
  if (Array.isArray(body.classTypeIds)) {
    await supabase.from('plan_class_types').delete().eq('plan_id', planId);
    if (body.classTypeIds.length > 0) {
      await supabase.from('plan_class_types').insert(
        body.classTypeIds.map((cid) => ({ plan_id: planId, class_type_id: cid })),
      );
    }
  }

  // Look up the gym's Connect account; without it we can't mirror.
  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id, charges_enabled, default_currency')
    .eq('gym_id', gymId)
    .maybeSingle();

  let stripeProductId = existingPlan?.stripe_product_id ?? null;
  let stripePriceId = existingPlan?.stripe_price_id ?? null;
  const stripeStatus: { ok: boolean; reason?: string } = { ok: false };

  if (!connect?.provider_account_id) {
    stripeStatus.reason = 'No Stripe Connect account — plan saved locally only.';
  } else {
    const accountId = connect.provider_account_id;
    const stripeOpts = { stripeAccount: accountId };
    const currency = connect.default_currency ?? 'gbp';

    try {
      // Product: create on first save, update on rename.
      if (!stripeProductId) {
        const product = await stripe.products.create(
          { name: name.trim(), metadata: { gym_id: gymId, plan_id: planId } },
          stripeOpts,
        );
        stripeProductId = product.id;
      } else if (existingPlan && existingPlan.name !== name.trim()) {
        await stripe.products.update(
          stripeProductId,
          { name: name.trim() },
          stripeOpts,
        );
      }

      // Price: create a fresh one if missing or price changed.
      const priceChanged =
        existingPlan?.monthly_price_cents !== (body.monthlyPriceCents ?? null);
      if (!stripePriceId || priceChanged) {
        if (body.monthlyPriceCents != null && body.monthlyPriceCents > 0) {
          const recurring =
            kind === 'credit_pack'
              ? undefined
              : {
                  interval: body.billing!.interval,
                  interval_count: body.billing!.intervalCount,
                };
          const price = await stripe.prices.create(
            {
              product: stripeProductId,
              unit_amount: body.monthlyPriceCents,
              currency,
              recurring,
              metadata: { gym_id: gymId, plan_id: planId },
            },
            stripeOpts,
          );
          stripePriceId = price.id;
        }
      }

      // Persist Stripe IDs.
      await supabase
        .from('membership_plans')
        .update({
          stripe_product_id: stripeProductId,
          stripe_price_id: stripePriceId,
        })
        .eq('plan_id', planId);
      stripeStatus.ok = true;
    } catch (err) {
      console.error('stripe sync failed', err);
      stripeStatus.reason = `Stripe sync failed: ${(err as Error).message}`;
    }
  }

  return new Response(
    JSON.stringify({
      planId,
      stripeProductId,
      stripePriceId,
      stripeStatus,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    },
  );
});
