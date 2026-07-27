-- The test that would have caught it.
--
-- is_revenue_event shipped matching Stripe's own event names
-- ('charge.succeeded', 'invoice.paid') while stripe-webhook wrote its own
-- shorter kinds. Nothing matched, so compute_revenue_summary returned no
-- rows for any gym from 0080 until 0173 — and an empty result reads as
-- "no revenue yet", not as a fault.
--
-- These assertions are deliberately written against the literal strings
-- the edge functions emit. If someone renames a kind in
-- supabase/functions/stripe-webhook/index.ts without updating
-- is_revenue_event, this file fails instead of the dashboard silently
-- going to zero.

begin;
select plan(8);

\ir _helpers.psql

select ok(
  public.is_revenue_event('stripe', 'checkout'),
  'checkout counts — membership Checkout Session completed'
);

select ok(
  public.is_revenue_event('stripe', 'invoice'),
  'invoice counts — membership renewal paid'
);

select ok(
  public.is_revenue_event('stripe', 'store_order'),
  'store_order counts — one-off store purchase paid'
);

select ok(
  public.is_revenue_event('stripe', 'store_subscription'),
  'store_subscription counts — recurring store cycle paid'
);

select ok(
  not public.is_revenue_event('stripe', 'refund'),
  'refund does not count — recorded for audit, never netted off gross'
);

select ok(
  not public.is_revenue_event('stripe', 'payment_failed'),
  'payment_failed does not count — recorded for the audit trail (0174), never collected'
);

select ok(
  not public.is_revenue_event('paypal', 'checkout'),
  'a kind we know is still ignored from a provider we do not'
);

-- Stripe's own naming is kept so anything imported under it still counts.
select ok(
  public.is_revenue_event('stripe', 'charge.succeeded')
    and public.is_revenue_event('stripe', 'invoice.paid'),
  'the original Stripe-native names still count'
);

select * from finish();
rollback;
