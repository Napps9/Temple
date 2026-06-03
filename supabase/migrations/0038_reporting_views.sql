-- Phase 1 / Track G: reporting materialised views (§6.1, §6.3).
--
-- Owner-facing analytics: lifecycle bucket counts, conversion
-- funnel (comp grant → first paid), weekly attendance. All three
-- are MVs refreshed off Track A's pg_cron — fast reads, eventually
-- consistent within an hour. MVs can't carry RLS so each one has
-- a SECURITY DEFINER accessor that gates on user_can_assign_plan.
--
-- The "no_show" leg of attendance is deferred until class_check_ins
-- lands in sprint 5 — for now attendance shows headcount only.

-- ============================================================================
-- 1. mv_member_lifecycle_buckets
--    One row per (gym_id, profile_id, bucket). Buckets:
--      intro     — active comp_grant, no paid plan_subscription
--      active    — has active plan_subscription
--      paused    — has paused plan_subscription
--      expiring  — cancelled_at_period_end with paid_period_end <= 14 days
--      expired   — most recent plan_sub is terminal and ended in last 30 days
--      lapsed    — has a lapsed plan_subscription (no active replacement)
--
--    A member can appear in multiple buckets (e.g. "intro" + about
--    to convert). The accessor aggregates counts.
-- ============================================================================

create materialized view public.mv_member_lifecycle_buckets as
  with current_subs as (
    select gym_id, profile_id, status, paid_period_end,
           row_number() over (
             partition by gym_id, profile_id
             order by
               case status
                 when 'active' then 1
                 when 'paused' then 2
                 when 'cancelled_at_period_end' then 3
                 when 'pending' then 4
                 when 'scheduled' then 4
                 when 'lapsed' then 5
                 when 'refunded_retained' then 6
                 when 'cancelled' then 7
               end,
               cancelled_at desc nulls first,
               created_at desc
           ) as rnk
    from public.plan_subscriptions
  ),
  primary_sub as (
    select gym_id, profile_id, status, paid_period_end
    from current_subs where rnk = 1
  ),
  active_comp as (
    select gym_id, profile_id
    from public.comp_grants
    where revoked_at is null
      and now() >= starts_at
      and now() <  ends_at
    group by gym_id, profile_id
  )
  select gym_id, profile_id, bucket from (
    -- intro: active comp grant + no current paid sub
    select c.gym_id, c.profile_id, 'intro'::text as bucket
    from active_comp c
    left join primary_sub p on p.gym_id = c.gym_id and p.profile_id = c.profile_id
    where p.status is null or p.status not in ('active','paused','cancelled_at_period_end','refunded_retained')

    union all
    select gym_id, profile_id, 'active' from primary_sub where status = 'active'

    union all
    select gym_id, profile_id, 'paused' from primary_sub where status = 'paused'

    union all
    select gym_id, profile_id, 'expiring'
    from primary_sub
    where status = 'cancelled_at_period_end'
      and paid_period_end is not null
      and paid_period_end <= now() + interval '14 days'

    union all
    select gym_id, profile_id, 'expired'
    from primary_sub
    where status in ('cancelled','lapsed','refunded_retained')
      and paid_period_end is not null
      and paid_period_end >= now() - interval '30 days'
      and paid_period_end <  now()

    union all
    select gym_id, profile_id, 'lapsed' from primary_sub where status = 'lapsed'
  ) all_buckets;

create unique index mv_member_lifecycle_buckets_pk
  on public.mv_member_lifecycle_buckets(gym_id, profile_id, bucket);
create index mv_member_lifecycle_buckets_gym_idx
  on public.mv_member_lifecycle_buckets(gym_id);

-- ============================================================================
-- 2. mv_conversion_funnel
--    For each (gym, comp_grant), did the recipient subsequently pay
--    within 90 days? converted_at is the timestamp of the first paid
--    billing_event after the grant was issued.
-- ============================================================================

create materialized view public.mv_conversion_funnel as
  with grants as (
    select grant_id, gym_id, profile_id, created_at
    from public.comp_grants
  ),
  first_paid as (
    select be.member_id as profile_id, be.gym_id, min(be.occurred_at) as paid_at
    from public.billing_events be
    where be.kind = 'invoice.paid'
      and be.gym_id is not null
    group by be.member_id, be.gym_id
  )
  select
    g.gym_id,
    g.grant_id,
    g.profile_id,
    g.created_at as grant_issued_at,
    fp.paid_at   as converted_at,
    case
      when fp.paid_at is null then false
      when fp.paid_at < g.created_at then false
      when fp.paid_at > g.created_at + interval '90 days' then false
      else true
    end as converted_within_90d
  from grants g
  left join first_paid fp
    on fp.profile_id = g.profile_id and fp.gym_id = g.gym_id;

create unique index mv_conversion_funnel_pk
  on public.mv_conversion_funnel(gym_id, grant_id);

-- ============================================================================
-- 3. mv_attendance_weekly
--    Per (gym, week starting Monday, class_type), bookings count.
--    No-show count is deferred until 0039 class_check_ins lands.
-- ============================================================================

create materialized view public.mv_attendance_weekly as
  select
    cs.gym_id,
    date_trunc('week', cs.starts_at)::date as week_start,
    cs.class_type_id,
    count(cb.id)::integer as bookings_count,
    count(distinct cb.profile_id)::integer as unique_members
  from public.class_sessions cs
  join public.class_bookings cb on cb.class_session_id = cs.id
  group by cs.gym_id, date_trunc('week', cs.starts_at), cs.class_type_id;

create unique index mv_attendance_weekly_pk
  on public.mv_attendance_weekly(gym_id, week_start, class_type_id);

-- ============================================================================
-- 4. Accessors — RLS-aware reads.
-- ============================================================================

create or replace function public.get_lifecycle_bucket_counts(
  p_gym_id uuid
) returns table (
  bucket text,
  count  integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  return query
    select b.bucket, count(*)::integer
    from public.mv_member_lifecycle_buckets b
    where b.gym_id = p_gym_id
    group by b.bucket
    order by b.bucket;
end;
$$;
grant execute on function public.get_lifecycle_bucket_counts(uuid) to authenticated;

create or replace function public.get_conversion_funnel(
  p_gym_id uuid,
  p_since  timestamptz default null
) returns table (
  grants_issued   integer,
  grants_converted integer,
  conversion_rate  numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  return query
    select
      count(*)::integer as grants_issued,
      count(*) filter (where converted_within_90d)::integer as grants_converted,
      case when count(*) = 0 then 0
           else round(100.0 * count(*) filter (where converted_within_90d) / count(*), 1)
      end as conversion_rate
    from public.mv_conversion_funnel
    where gym_id = p_gym_id
      and (p_since is null or grant_issued_at >= p_since);
end;
$$;
grant execute on function public.get_conversion_funnel(uuid, timestamptz) to authenticated;

create or replace function public.get_attendance_weekly(
  p_gym_id uuid,
  p_weeks  integer default 12
) returns table (
  week_start      date,
  class_type_id   uuid,
  class_type_name text,
  bookings_count  integer,
  unique_members  integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  return query
    select
      a.week_start,
      a.class_type_id,
      ct.name,
      a.bookings_count,
      a.unique_members
    from public.mv_attendance_weekly a
    left join public.class_types ct on ct.id = a.class_type_id
    where a.gym_id = p_gym_id
      and a.week_start >= (current_date - (p_weeks || ' weeks')::interval)::date
    order by a.week_start desc, ct.name;
end;
$$;
grant execute on function public.get_attendance_weekly(uuid, integer) to authenticated;

-- ============================================================================
-- 5. Refresh cron — hourly at :30 to offset from PR (:15) and
--    predictions (:20) refreshes.
-- ============================================================================

create or replace function public.cron_refresh_reporting_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.mv_member_lifecycle_buckets;
  refresh materialized view concurrently public.mv_conversion_funnel;
  refresh materialized view concurrently public.mv_attendance_weekly;
end;
$$;

select cron.schedule(
  'temple_refresh_reporting_views',
  '30 * * * *',
  $$select public.cron_refresh_reporting_views();$$
);
