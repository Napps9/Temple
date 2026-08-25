#!/usr/bin/env node
// Exercises the two things about coupons (0264) that pgTAP cannot reach:
// the Stripe Coupon this codebase creates, and the Checkout Session it
// attaches the coupon to. Everything else about a coupon — who may write
// one, which codes apply, what the caps mean — is asserted in
// supabase/tests/a_price_that_holds_for_three_months.sql.
//
// It builds its parameters the same way supabase/functions/stripe-checkout
// does, so a mistake in the shape of those calls fails here rather than in
// front of a member.
//
//   STRIPE_SECRET_KEY=sk_test_... \
//   STRIPE_CONNECTED_ACCOUNT=acct_... \
//   node scripts/stripe-check/coupon-check.mjs
//
// Refuses a live key. Creates test-mode objects on the connected account
// and deletes what it can on the way out; a Checkout Session cannot be
// deleted, but an unpaid one expires on its own.

const KEY = process.env.STRIPE_SECRET_KEY;
const ACCOUNT = process.env.STRIPE_CONNECTED_ACCOUNT;
const CURRENCY = (process.env.STRIPE_CURRENCY ?? 'gbp').toLowerCase();

if (!KEY) fail('STRIPE_SECRET_KEY is not set');
if (!KEY.startsWith('sk_test_')) {
  fail('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key (sk_test_...)');
}
if (!ACCOUNT) fail('STRIPE_CONNECTED_ACCOUNT is not set (acct_...)');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// Same request shape as supabase/functions/_shared and stripe-checkout:
// form-encoded, on the connected account via the Stripe-Account header.
async function stripe(path, params, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Account': ACCOUNT,
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // A proxy, an outage or a captive network — say which, rather than
    // reporting a JSON parse error against Stripe's name.
    throw new Error(
      `${path}: ${res.status} from api.stripe.com, and the body was not JSON: ${text.slice(0, 120)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`${path}: ${json?.error?.message ?? res.status}`);
  }
  return json;
}

const created = { coupons: [], prices: [], products: [] };
let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — got ${actual}, expected ${expected}`}`);
  if (!ok) failures += 1;
}

// The coupon params stripe-checkout builds, verbatim in shape.
function couponParams(coupon) {
  const params =
    coupon.discount_kind === 'percent'
      ? { percent_off: String(coupon.percent_off) }
      : {
          amount_off: String(coupon.amount_off_cents),
          currency: (coupon.currency ?? CURRENCY).toLowerCase(),
        };
  params.duration = coupon.duration;
  if (coupon.duration === 'repeating') {
    params.duration_in_months = String(coupon.duration_in_months);
  }
  params.name = coupon.name ?? coupon.code;
  params['metadata[gym_id]'] = 'gym_check';
  params['metadata[coupon_id]'] = 'coupon_check';
  return params;
}

async function makePrice({ cents, recurring }) {
  const product = await stripe('products', { name: 'Coupon check plan' });
  created.products.push(product.id);
  const priceParams = {
    product: product.id,
    currency: CURRENCY,
    unit_amount: String(cents),
  };
  if (recurring) priceParams['recurring[interval]'] = 'month';
  const price = await stripe('prices', priceParams);
  created.prices.push(price.id);
  return price.id;
}

async function session({ priceId, couponId, recurring }) {
  const params = {
    mode: recurring ? 'subscription' : 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: 'https://example.test/?checkout=success',
    cancel_url: 'https://example.test/?checkout=cancelled',
    'metadata[gym_id]': 'gym_check',
    'metadata[coupon_id]': 'coupon_check',
    'discounts[0][coupon]': couponId,
  };
  const prefix = recurring
    ? 'subscription_data[metadata]'
    : 'payment_intent_data[metadata]';
  params[`${prefix}[gym_id]`] = 'gym_check';
  params[`${prefix}[coupon_id]`] = 'coupon_check';
  return stripe('checkout/sessions', params);
}

try {
  console.log(`Running against ${ACCOUNT} in test mode.\n`);

  // 1. Percent, repeating — "50% off for 3 months" on a membership.
  const pct = await stripe(
    'coupons',
    couponParams({
      discount_kind: 'percent',
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 3,
      code: 'JAN50',
      name: 'January half price',
    }),
  );
  created.coupons.push(pct.id);
  check('percent coupon: percent_off', pct.percent_off, 50);
  check('percent coupon: duration', pct.duration, 'repeating');
  check('percent coupon: duration_in_months', pct.duration_in_months, 3);

  const subPrice = await makePrice({ cents: 6000, recurring: true });
  const subSession = await session({
    priceId: subPrice,
    couponId: pct.id,
    recurring: true,
  });
  check('subscription session: discount applied', subSession.total_details?.amount_discount, 3000);
  check('subscription session: amount_total', subSession.amount_total, 3000);

  // 2. Fixed amount, once — "£15 off your first month".
  const amt = await stripe(
    'coupons',
    couponParams({
      discount_kind: 'amount',
      amount_off_cents: 1500,
      currency: CURRENCY,
      duration: 'once',
      code: 'FIFTEEN',
      name: 'Fifteen off',
    }),
  );
  created.coupons.push(amt.id);
  check('amount coupon: amount_off', amt.amount_off, 1500);
  check('amount coupon: currency', amt.currency, CURRENCY);

  const packPrice = await makePrice({ cents: 9000, recurring: false });
  const packSession = await session({
    priceId: packPrice,
    couponId: amt.id,
    recurring: false,
  });
  check('one-off session: discount applied', packSession.total_details?.amount_discount, 1500);
  check('one-off session: amount_total', packSession.amount_total, 7500);

  // 3. The immutability the schema freezes on. Stripe should refuse to
  //    change the money, and allow the name — which is exactly what
  //    _plan_coupon_freeze permits and forbids.
  try {
    await stripe(`coupons/${pct.id}`, { percent_off: '90' });
    console.log('✗ Stripe accepted a changed percent_off — the freeze in 0264 assumes it will not');
    failures += 1;
  } catch {
    console.log('✓ Stripe refuses to change percent_off after creation');
  }
  const renamed = await stripe(`coupons/${pct.id}`, { name: 'Renamed' });
  check('coupon name is still editable', renamed.name, 'Renamed');
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  failures += 1;
} finally {
  for (const id of created.coupons) {
    await stripe(`coupons/${id}`, null, 'DELETE').catch(() => {});
  }
  for (const id of created.prices) {
    await stripe(`prices/${id}`, { active: 'false' }).catch(() => {});
  }
  for (const id of created.products) {
    await stripe(`products/${id}`, { active: 'false' }).catch(() => {});
  }
}

console.log(
  failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check${failures === 1 ? '' : 's'} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
