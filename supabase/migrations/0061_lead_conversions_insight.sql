-- Surface lead conversions on the Insights summary so the leads
-- pipeline starts paying off in the dashboard.
--
-- compute_insight_summary returns a fixed table shape that the UI
-- decodes positionally. Adding a column means DROP + CREATE (CREATE
-- OR REPLACE can't change the RETURNS clause). The new column,
-- lead_conversions, counts leads whose converted_at fell inside the
-- requested period — this is independent of the billing-side
-- "conversions" (which still tracks first paying billing_event).

begin;

drop function if exists public.compute_insight_summary(uuid, date, date);

create function public.compute_insight_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  intros_new         integer,
  intros_target      integer,
  conversions        integer,
  conversions_target integer,
  expiring_soon      integer,
  expired            integer,
  paying_now         integer,
  billing_live       boolean,
  lead_conversions   integer
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
    select metric, target_value from public.gym_insight_targets
    where gym_id = p_gym_id
      and period = case
        when p_period_end - p_period_start <= 31 then 'month'
        else 'quarter'
      end
  )
  select
    (select count(*)::int from cohort
      where is_intro
        and joined_at::date between p_period_start and p_period_end),
    coalesce((select target_value from targets where metric = 'intros_new'), 0),
    (select coalesce(n, 0)::int from conv),
    coalesce((select target_value from targets where metric = 'conversions'), 0),
    (select count(*)::int from cohort where is_expiring_soon),
    (select count(*)::int from cohort where is_expired),
    (select count(*)::int from cohort where is_paying),
    exists(select 1 from public.billing_events where gym_id = p_gym_id),
    (select coalesce(n, 0) from lead_conv);
end;
$$;

grant execute on function public.compute_insight_summary(uuid, date, date) to authenticated;

commit;
