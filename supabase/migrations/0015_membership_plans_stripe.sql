-- Phase 1 / Track A: wire membership_plans to Stripe Products / Prices
-- and add per-plan notice period.
--
-- stripe_product_id / stripe_price_id are nullable: plans can exist
-- before being mirrored to Stripe (drafts, comp-only plans), and the
-- mirror step is async.
--
-- notice_period is the per-plan cancellation notice (plan §3.1):
--   - 0 default = no notice; access ends at the prepaid period end.
--   - non-zero = notice expires at now() + notice_period; access AND
--     billing are rounded up to the end of the billing period that
--     notice expires in (the rounding lives in the cancel_subscription
--     RPC in Track B, not in this column).
--
-- The choice to bill through the notice period — not grant a grace
-- tail — preserves the spec's money-paid / access-granted
-- reconciliation invariant: every access window has a charge behind
-- it.

alter table public.membership_plans
  add column stripe_product_id text,
  add column stripe_price_id   text,
  add column notice_period     interval not null default '0';

create index membership_plans_stripe_price_idx
  on public.membership_plans(stripe_price_id)
  where stripe_price_id is not null;
