-- Targets currently only support a plain headcount per month/quarter.
-- Owners want Conversions/Retention expressed as a rate (e.g. "65%
-- conversion", "90% retention" reads more naturally than a raw count)
-- and want Week/Year timeframes to match the Insights page's own
-- date-range presets (7d/30d/month/quarter/year/custom).
--
-- New Intros has no natural denominator for a rate, so it stays
-- count-only — enforced with a check constraint rather than trusting
-- the client.
--
-- compute_insight_summary's RETURNS shape is changing (new columns),
-- which CREATE OR REPLACE can't do — DROP + CREATE, per the 0043
-- lesson noted in CLAUDE.md.

begin;

alter table public.gym_insight_targets
  add column unit text not null default 'count' check (unit in ('count', 'rate'));

alter table public.gym_insight_targets
  drop constraint gym_insight_targets_period_check;
alter table public.gym_insight_targets
  add constraint gym_insight_targets_period_check
  check (period in ('week', 'month', 'quarter', 'year'));

alter table public.gym_insight_targets
  add constraint gym_insight_targets_intros_count_only
  check (metric <> 'intros_new' or unit = 'count');

alter table public.gym_insight_targets
  add constraint gym_insight_targets_rate_is_percent
  check (unit <> 'rate' or target_value <= 100);

drop function if exists public.compute_insight_summary(uuid, date, date);

create function public.compute_insight_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  intros_new              integer,
  intros_target           integer,
  conversions             integer,
  conversions_target      integer,
  conversions_target_unit text,
  retention_now           integer,
  retention_base          integer,
  retention_target        integer,
  retention_target_unit   text,
  expiring_soon           integer,
  expired                 integer,
  paying_now              integer,
  billing_live            boolean,
  lead_conversions        integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;

  return query
  with cohort as (
    select * from public.v_member_cohort where gym_id = p_gym_id
  ),
  conv as (
    select count(distinct be.member_id) as n
    from public.billing_events be
    where be.gym_id = p_gym_id
      and be.kind in ('charge.succeeded', 'invoice.paid')
      and be.occurred_at::date between p_period_start and p_period_end
      and not exists (
        select 1 from public.billing_events be2
        where be2.gym_id = p_gym_id
          and be2.member_id = be.member_id
          and be2.kind in ('charge.succeeded', 'invoice.paid')
          and be2.occurred_at < be.occurred_at
      )
  ),
  lead_conv as (
    -- A converted lead is one whose status flipped to 'converted'
    -- (regardless of how: auto-attribute on signup or staff
    -- explicit) inside the period.
    select count(*)::int as n
    from public.leads l
    where l.gym_id = p_gym_id
      and l.converted_at::date between p_period_start and p_period_end
  ),
  targets as (
    select metric, target_value, unit from public.gym_insight_targets
    where gym_id = p_gym_id
      and period = case
        when p_period_end - p_period_start <= 7 then 'week'
        when p_period_end - p_period_start <= 31 then 'month'
        when p_period_end - p_period_start <= 92 then 'quarter'
        else 'year'
      end
  )
  select
    (select count(*)::int from cohort
      where is_intro
        and joined_at::date between p_period_start and p_period_end),
    coalesce((select target_value from targets where metric = 'intros_new'), 0),
    (select coalesce(n, 0)::int from conv),
    coalesce((select target_value from targets where metric = 'conversions'), 0),
    coalesce((select unit from targets where metric = 'conversions'), 'count'),
    -- Retained = a member as of period start who is still a member
    -- (not left) as of period end. Base = members as of period start,
    -- so retention_now/retention_base is the retention rate.
    (select count(*)::int from public.gym_memberships
      where gym_id = p_gym_id and role = 'member'
        and created_at::date <= p_period_start
        and (left_at is null or left_at::date > p_period_end)),
    (select count(*)::int from public.gym_memberships
      where gym_id = p_gym_id and role = 'member'
        and created_at::date <= p_period_start
        and (left_at is null or left_at::date > p_period_start)),
    coalesce((select target_value from targets where metric = 'retention'), 0),
    coalesce((select unit from targets where metric = 'retention'), 'count'),
    (select count(*)::int from cohort where is_expiring_soon),
    (select count(*)::int from cohort where is_expired),
    (select count(*)::int from cohort where is_paying),
    exists(select 1 from public.billing_events where gym_id = p_gym_id),
    (select coalesce(n, 0) from lead_conv);
end;
$$;

grant execute on function public.compute_insight_summary(uuid, date, date) to authenticated;

commit;
