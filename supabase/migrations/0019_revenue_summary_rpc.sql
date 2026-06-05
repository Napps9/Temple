-- Phase 3+ dashboard support: provider-agnostic revenue aggregation.
--
-- Reads billing_events (0010) and rolls up gross amounts per currency
-- within an arbitrary date range. The manage-page "Revenue" tile and
-- any future revenue dashboard use this RPC.
--
-- IMPORTANT — provider-agnostic by design:
-- All knowledge about which provider events count as "money in" lives
-- in is_revenue_event() below. When a new payment provider lands
-- (GoCardless, Square, Adyen, etc.), the only file to edit is THIS
-- one — extend the CASE inside is_revenue_event() and nothing else
-- in the dashboard layer needs to change. The classifier intentionally
-- excludes refunds and disputes — they're tracked separately.

-- ============================================================================
-- 1. is_revenue_event(provider, kind) — the single source of truth for
--    "this billing event represents money coming in for this gym".
-- ============================================================================

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
    when p_provider = 'stripe' and p_kind in ('charge.succeeded', 'invoice.paid') then true
    else false
  end;
$$;

grant execute on function public.is_revenue_event(text, text) to authenticated;

-- ============================================================================
-- 2. compute_revenue_summary(gym_id, period_start, period_end)
--    Returns one row per currency present in the period — gross cents
--    and the count of qualifying events. Empty result = no revenue.
-- ============================================================================

create or replace function public.compute_revenue_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  currency     text,
  gross_cents  bigint,
  charge_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;

  return query
  select
    be.currency,
    sum(be.amount_cents)::bigint as gross_cents,
    count(*)::int                as charge_count
  from public.billing_events be
  where be.gym_id = p_gym_id
    and public.is_revenue_event(be.provider, be.kind)
    and be.occurred_at::date between p_period_start and p_period_end
  group by be.currency;
end;
$$;

grant execute on function public.compute_revenue_summary(uuid, date, date) to authenticated;
