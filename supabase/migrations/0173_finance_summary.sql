-- Revenue that actually reads: fix is_revenue_event, add a month-shaped
-- finance summary.
--
-- The Revenue tile on Manage -> Members has been reading zero for every
-- gym since Stripe billing shipped (0080), and it reads as "no revenue
-- yet" rather than as a fault, which is why nobody noticed.
--
-- is_revenue_event (0019) matches 'charge.succeeded' and 'invoice.paid'.
-- Those are STRIPE'S event type names. stripe-webhook does not write
-- them — it writes its own shorter kinds:
--
--   checkout            supabase/functions/stripe-webhook/index.ts:631
--   invoice             ...:755
--   store_order         ...:422
--   store_subscription  ...:707
--   refund              supabase/functions/stripe-refund/index.ts:464
--
-- Not one of those matched, so compute_revenue_summary returned no rows,
-- always. No pgTAP test covered any of this; revenue_event_kinds.sql is
-- added alongside this migration so the next rename fails a test instead
-- of silently zeroing the dashboard. The two lists — this CASE and the
-- webhook's `kind:` literals — have to be edited together. That is the
-- trap that sprang.
--
-- Double counting, for whoever reads this next: billing_events rows of
-- kind store_order / store_subscription describe the same money as
-- store_orders. compute_revenue_summary is now the TOTAL (memberships +
-- store + programming) and store_revenue_summary is the store BREAKDOWN
-- — a subset of it, never something to add on top. The Manage tile
-- already described itself as "all sales", so widening is what makes it
-- true rather than what makes it double.
--
-- Sections:
--   1. is_revenue_event      — match the kinds actually written
--   2. compute_finance_summary — confirmed / pending / forward, by month

begin;

-- ============================================================================
-- 1. is_revenue_event
-- ============================================================================
--
-- Refunds stay excluded, deliberately, as in 0019: a refund is recorded
-- so it can be audited, not so it can be netted off gross. The two
-- Stripe-native names are kept as well — harmless, and any row imported
-- under Stripe's own naming still counts.

create or replace function public.is_revenue_event(p_provider text, p_kind text)
returns boolean
language sql
immutable
as $$
  -- Add a new branch here when onboarding a new payment provider.
  -- Keep this list narrow: only events that represent SETTLED money
  -- belonging to the gym. Refunds, disputes, and failed payments are
  -- intentionally excluded.
  select case
    when p_provider = 'stripe' and p_kind in (
      -- Written by stripe-webhook today.
      'checkout',            -- membership Checkout Session completed
      'invoice',             -- membership renewal paid
      'store_order',         -- one-off store purchase paid
      'store_subscription',  -- recurring store purchase cycle paid
      -- Stripe's own event names, for anything imported under them.
      'charge.succeeded',
      'invoice.paid'
    ) then true
    else false
  end;
$$;

grant execute on function public.is_revenue_event(text, text) to authenticated;

-- ============================================================================
-- 2. compute_finance_summary
-- ============================================================================
--
-- One call per calendar month, one row per currency:
--
--   confirmed  — settled billing_events inside the month. Money in.
--   pending    — recurring memberships whose paid_period_end falls after
--                now() and on or before month end: the charges Stripe
--                will attempt before the month is out. SCHEDULED, not
--                overdue — see the limitation note below.
--   forward    — what the active memberships are worth per month from
--                here, at the price each member actually pays.
--
-- Money owed is NOT modelled, because Temple cannot see it: plan_sub_state
-- (0008) has no past_due/unpaid, there is no invoice.payment_failed
-- handler in stripe-webhook, and plan_subscriptions.awaiting_payment_
-- authentication is never written by any code path. A member whose card
-- fails stays 'active' with a stale paid_period_end until Stripe emits
-- customer.subscription.deleted. So a failed renewal sits inside `pending`
-- looking healthy. Fixing that means handling the failure event and adding
-- a status for it — a separate piece of work.
--
-- price_cents over monthly_price_cents: price_cents is the grandfathered
-- snapshot stamped at insert by plan_subscriptions_snapshot_price_trg
-- (0015), so a later price rise never silently re-rates an existing
-- member. coalesce covers rows predating that trigger.
--
-- credit_pack is excluded from both forward-looking numbers: it is a
-- one-off purchase with no Stripe subscription and no renewal, which is
-- the same reason 0125's lapse sweep skips it. unlimited, credit_period
-- and programming_only all bill monthly (stripe-checkout hardcodes
-- recurring[interval]=month).
--
-- Currency: confirmed carries its own from billing_events; pending and
-- forward have none of their own and use gyms.currency. A full join keeps
-- a gym with no settled events from losing its pending/forward row, and a
-- currency seen only in billing_events from losing its confirmed row.
-- Grouping by currency matters more than it looks: stripe-checkout
-- hardcodes `currency = 'gbp'` for memberships while store-checkout reads
-- gyms.currency, so a non-GBP gym can genuinely hold mixed currencies.

create or replace function public.compute_finance_summary(
  p_gym_id      uuid,
  p_month_start date
) returns table (
  currency          text,
  confirmed_cents   bigint,
  confirmed_count   integer,
  pending_cents     bigint,
  pending_count     integer,
  forward_mrr_cents bigint,
  forward_count     integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_month_end timestamptz;
  v_gym_ccy   text;
begin
  if not public.effective_can(p_gym_id, 'can_see_money') then
    raise exception 'Not authorised';
  end if;
  if p_month_start is null then
    raise exception 'Pick a month';
  end if;

  select g.currency into v_gym_ccy from public.gyms g where g.id = p_gym_id;
  if v_gym_ccy is null then
    raise exception 'Gym not found';
  end if;

  -- End-exclusive: the instant the next month begins.
  v_month_end := (p_month_start + interval '1 month')::timestamptz;

  return query
  with confirmed as (
    select be.currency as ccy,
           sum(be.amount_cents)::bigint as cents,
           count(*)::int as n
    from public.billing_events be
    where be.gym_id = p_gym_id
      and public.is_revenue_event(be.provider, be.kind)
      and be.occurred_at >= p_month_start::timestamptz
      and be.occurred_at <  v_month_end
    group by be.currency
  ),
  live as (
    select coalesce(ps.price_cents, mp.monthly_price_cents) as cents,
           ps.paid_period_end
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    where ps.gym_id = p_gym_id
      and ps.status in ('active'::public.plan_sub_state,
                        'cancelled_at_period_end'::public.plan_sub_state,
                        'refunded_retained'::public.plan_sub_state)
      and mp.kind <> 'credit_pack'
  ),
  -- One row, both forward-looking numbers, one pass over the memberships.
  -- `due` is the pending filter: renewing after now and before the month
  -- rolls over.
  agg as (
    select
      coalesce(sum(cents), 0)::bigint as fwd_cents,
      count(*)::int                   as fwd_n,
      coalesce(sum(cents) filter (where due), 0)::bigint as pend_cents,
      (count(*) filter (where due))::int                 as pend_n
    from (
      select cents,
             paid_period_end is not null
               and paid_period_end > now()
               and paid_period_end < v_month_end as due
      from live
    ) l
  ),
  -- Every currency worth a row: the ones money actually arrived in, plus
  -- the gym's own so pending/forward still surface before a first sale.
  ccy as (
    select c.ccy from confirmed c
    union
    select v_gym_ccy
  )
  select
    ccy.ccy,
    coalesce(c.cents, 0)::bigint,
    coalesce(c.n, 0),
    case when ccy.ccy = v_gym_ccy then a.pend_cents else 0::bigint end,
    case when ccy.ccy = v_gym_ccy then a.pend_n     else 0 end,
    case when ccy.ccy = v_gym_ccy then a.fwd_cents  else 0::bigint end,
    case when ccy.ccy = v_gym_ccy then a.fwd_n      else 0 end
  from ccy
  cross join agg a
  left join confirmed c on c.ccy = ccy.ccy
  order by 2 desc;
end;
$$;

grant execute on function public.compute_finance_summary(uuid, date) to authenticated;

commit;
