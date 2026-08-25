# Checking the Stripe half of coupons

`supabase/tests/a_price_that_holds_for_three_months.sql` covers everything
about a coupon that lives in Postgres: who may write one, which codes
apply to which plans, what the caps mean, that the money fields freeze
once Stripe holds the coupon, and that a repeated webhook counts one
redemption. None of it touches Stripe.

Two things it cannot reach, because they only exist on the other side of
an API call: the Coupon `stripe-checkout` creates on the gym's connected
account, and the Checkout Session it attaches that coupon to. This script
makes both, with the parameters built the same way the edge function
builds them, and asserts the discount actually lands.

```bash
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_CONNECTED_ACCOUNT=acct_... \
node scripts/stripe-check/coupon-check.mjs
```

`STRIPE_CURRENCY` overrides the default `gbp` — worth running once in the
currency of a gym that isn't British, since the currency a Price is
created in is immutable and was hardcoded until 0264's sibling fix.

It refuses anything that isn't an `sk_test_` key, and deletes the coupons
and deactivates the products and prices it made. A Checkout Session cannot
be deleted; an unpaid one expires on its own.

**It cannot be run from a Claude Code cloud session** — the egress policy
there blocks `api.stripe.com`, and the script says so plainly rather than
failing with a JSON parse error. Run it from a machine that can reach
Stripe.

## What it asserts

- A percent coupon comes back with the `percent_off`, `duration` and
  `duration_in_months` that were sent.
- A subscription Checkout Session carrying it discounts the total by the
  right amount (£60 → £30 at 50%).
- A fixed-amount coupon carries its `amount_off` and `currency`, and
  discounts a one-off (credit-pack) session — `mode: payment`, which is a
  different Stripe path from a subscription and worth exercising.
- **Stripe refuses to change `percent_off` after creation.** The freeze
  trigger in 0264 exists because of this; if Stripe ever allowed it, the
  trigger would be stricter than it needs to be and this check would say
  so.
- The coupon's `name` is still editable, which is what the trigger allows.
