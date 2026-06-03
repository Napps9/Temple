// Phase 1 last-mile: save-discount edge function (§3.4).
//
// Owner-only. Upserts a discounts row AND mirrors it into the gym's
// Connect Stripe account as a Coupon + PromotionCode. The promotion
// code is what members type at signup; signup-member attaches it to
// the Subscription so the actual Stripe charge is discounted —
// honouring spec's "must not show an in-app discount that has no
// effect on the real charge".
//
// Stripe Coupons are mostly immutable (duration, amount, percent
// can't change once created), so a value change creates a fresh
// Coupon + PromotionCode and rewrites stripe_coupon_id /
// stripe_promo_id. The old Coupon stays around for any subscription
// that's already redeemed it.

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

type Kind = 'percent' | 'amount';

type Body = {
  discountId?: string;
  gymId?: string;
  code?: string;
  kind?: Kind;
  value?: number; // basis points for percent, cents for amount
  validFrom?: string | null;
  validTo?: string | null;
  maxRedemptions?: number | null;
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
  const { gymId, code, kind, value } = body;
  if (!gymId || !code?.trim() || !kind || !value) {
    return bad(400, 'missing required fields');
  }
  if (kind === 'percent' && (value <= 0 || value > 10000)) {
    return bad(400, 'percent must be 1–10000 (basis points)');
  }
  if (kind === 'amount' && value <= 0) return bad(400, 'amount must be positive');

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
  let existing: {
    discount_id: string;
    stripe_coupon_id: string | null;
    stripe_promo_id: string | null;
    value: number;
    kind: Kind;
  } | null = null;
  if (body.discountId) {
    const { data } = await supabase
      .from('discounts')
      .select('discount_id, stripe_coupon_id, stripe_promo_id, value, kind')
      .eq('discount_id', body.discountId)
      .eq('gym_id', gymId)
      .maybeSingle();
    existing = data as typeof existing;
    if (!existing) return bad(404, 'discount not found');
  }

  const dbPayload = {
    gym_id: gymId,
    code: code.trim(),
    kind,
    value,
    valid_from: body.validFrom ?? null,
    valid_to: body.validTo ?? null,
    max_redemptions: body.maxRedemptions ?? null,
  };

  let discountId: string;
  if (existing) {
    const { error } = await supabase
      .from('discounts')
      .update(dbPayload)
      .eq('discount_id', existing.discount_id);
    if (error) return bad(500, `db: ${error.message}`);
    discountId = existing.discount_id;
  } else {
    const { data, error } = await supabase
      .from('discounts')
      .insert(dbPayload)
      .select('discount_id')
      .single();
    if (error) return bad(500, `db: ${error.message}`);
    discountId = data.discount_id;
  }

  // Stripe mirror.
  const { data: connect } = await supabase
    .from('stripe_connect_accounts')
    .select('provider_account_id, default_currency')
    .eq('gym_id', gymId)
    .maybeSingle();

  let stripeCouponId = existing?.stripe_coupon_id ?? null;
  let stripePromoId = existing?.stripe_promo_id ?? null;
  const stripeStatus: { ok: boolean; reason?: string } = { ok: false };

  if (!connect?.provider_account_id) {
    stripeStatus.reason = 'No Stripe Connect account — discount saved locally only.';
  } else {
    const accountId = connect.provider_account_id;
    const stripeOpts = { stripeAccount: accountId };
    const currency = connect.default_currency ?? 'gbp';
    const valueChanged =
      existing?.value !== value || existing?.kind !== kind;

    try {
      if (!stripeCouponId || valueChanged) {
        // Coupon values are immutable in Stripe — create a fresh one.
        const couponParams: Stripe.CouponCreateParams = {
          metadata: { gym_id: gymId, discount_id: discountId },
          duration: 'once',
        };
        if (kind === 'percent') {
          couponParams.percent_off = value / 100; // 2500 bps → 25%
        } else {
          couponParams.amount_off = value;
          couponParams.currency = currency;
        }
        const coupon = await stripe.coupons.create(couponParams, stripeOpts);
        stripeCouponId = coupon.id;

        // Promotion code wraps the coupon with a user-facing string.
        const promo = await stripe.promotionCodes.create(
          {
            coupon: stripeCouponId,
            code: code.trim(),
            max_redemptions: body.maxRedemptions ?? undefined,
            expires_at: body.validTo
              ? Math.floor(new Date(body.validTo).getTime() / 1000)
              : undefined,
            metadata: { gym_id: gymId, discount_id: discountId },
          },
          stripeOpts,
        );
        stripePromoId = promo.id;
      }

      await supabase
        .from('discounts')
        .update({
          stripe_coupon_id: stripeCouponId,
          stripe_promo_id: stripePromoId,
        })
        .eq('discount_id', discountId);
      stripeStatus.ok = true;
    } catch (err) {
      console.error('stripe coupon sync failed', err);
      stripeStatus.reason = `Stripe sync failed: ${(err as Error).message}`;
    }
  }

  return new Response(
    JSON.stringify({ discountId, stripeCouponId, stripePromoId, stripeStatus }),
    {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    },
  );
});
