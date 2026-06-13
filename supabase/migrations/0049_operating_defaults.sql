-- Operating defaults + Phase 0 nitpicks.
--
-- Multi-tenant configurability pass. Two things bundled:
--
--  1. Phase 0 nitpicks Alex flagged that needed shape corrections so
--     we don't bake single-gym assumptions: per-class-type default
--     capacity (US gyms run 30-person open-gym + 12-person CrossFit);
--     a structural `coach_required` + customisable `unsupervised_label`
--     in place of a literal "Unsupervised" enum; a free-text location
--     field on class sessions + recurrences for multi-room gyms; a
--     `gyms.week_starts_on` for the Sun-first US gyms the calendar
--     hard-locked to Mon-first.
--
--  2. Phase 0.5 operating defaults that hoist magic numbers out of
--     SQL bodies into per-gym settings so each gym can mean what it
--     means by them:
--       - expiring_within_days (was hard 7 in v_member_cohort)
--       - parq_expiry_days     (was hard 365 in _book_class_for +
--                               current_parq_state)
--       - health_retention_months (was hard 3 in purge_expired_…)
--     Defaults preserve current behaviour exactly. The view + the two
--     RPCs + the purge function are rewritten to read these from the
--     gym row.
--
-- Also seeds new columns for future settings the Operating defaults
-- settings card surfaces (`timezone`, `lead_conversion_window_days`,
-- `materialisation_horizon_weeks`, `subscription_resolution`,
-- `default_class_capacity`, `default_class_minutes`). They're
-- additive only — no SQL reads them yet — but having them landed
-- means the next phases of Alex's work don't need a migration.

begin;

-- ============================================================================
-- 1. Phase 0 schema additions
-- ============================================================================

alter table public.gyms
  add column if not exists week_starts_on        text not null default 'mon'
    check (week_starts_on in ('mon', 'sun')),
  add column if not exists timezone              text not null default 'UTC',
  add column if not exists default_class_capacity integer not null default 12
    check (default_class_capacity > 0),
  add column if not exists default_class_minutes  integer not null default 60
    check (default_class_minutes > 0);

alter table public.class_types
  add column if not exists default_capacity   integer
    check (default_capacity is null or default_capacity > 0),
  add column if not exists coach_required     boolean not null default true,
  add column if not exists unsupervised_label text not null default 'Unsupervised';

alter table public.class_sessions
  add column if not exists location text;

alter table public.class_recurrences
  add column if not exists location text;

-- ============================================================================
-- 2. Phase 0.5 operating defaults columns
-- ============================================================================
--
-- Each default exactly preserves the prior hard-coded value. Sentinel
-- defaults mean an existing gym row sees zero behaviour change after
-- this migration; only when an owner edits a value via the Operating
-- defaults card does anything change.

alter table public.gyms
  add column if not exists expiring_within_days       integer not null default 7
    check (expiring_within_days between 1 and 90),
  add column if not exists parq_expiry_days           integer not null default 365
    check (parq_expiry_days between 30 and 1825),
  add column if not exists health_retention_months    integer not null default 3
    check (health_retention_months between 1 and 60),
  add column if not exists lead_conversion_window_days integer not null default 30
    check (lead_conversion_window_days between 1 and 365),
  add column if not exists materialisation_horizon_weeks integer not null default 12
    check (materialisation_horizon_weeks between 4 and 52),
  add column if not exists subscription_resolution    text not null default 'credits_first'
    check (subscription_resolution in ('credits_first', 'newest_first', 'highest_priority'));

-- ============================================================================
-- 3. v_member_cohort: expiring_within_days now reads from the gym
-- ============================================================================
--
-- The view's shape is unchanged; the `is_expiring_soon` predicate
-- joins gyms to pull the per-gym window instead of hard-coding 7.

create or replace view public.v_member_cohort
with (security_invoker = on)
as
with cohort as (
  select
    gm.gym_id,
    gm.profile_id,
    gm.created_at as joined_at,
    public.has_ever_paid(gm.profile_id, gm.gym_id)         as is_paying,
    public.is_active_relationship(gm.profile_id, gm.gym_id) as is_active,
    (
      select min(extract(day from (ps.paid_period_end - now())))::integer
      from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
        and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
        and ps.paid_period_end is not null
        and ps.paid_period_end > now()
    ) as plan_days_until_expiry,
    (
      select min(extract(day from (cg.ends_at - now())))::integer
      from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and cg.ends_at > now()
    ) as comp_days_until_expiry,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and now() >= cg.starts_at
        and now() <  cg.ends_at
    ) as has_live_comp,
    exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
    ) as ever_had_plan,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
    ) as ever_had_comp,
    g.expiring_within_days
  from public.gym_memberships gm
  join public.gyms g on g.id = gm.gym_id
  where gm.role = 'member'
    and gm.left_at is null
)
select
  c.gym_id,
  c.profile_id,
  c.joined_at,
  (c.has_live_comp and not c.is_paying)             as is_intro,
  c.is_paying,
  c.is_active,
  least(c.plan_days_until_expiry, c.comp_days_until_expiry) as days_until_expiry,
  (
    least(c.plan_days_until_expiry, c.comp_days_until_expiry) is not null
    and least(c.plan_days_until_expiry, c.comp_days_until_expiry)
      between 0 and c.expiring_within_days
  ) as is_expiring_soon,
  (
    not c.is_active
    and (c.ever_had_plan or c.ever_had_comp)
  ) as is_expired
from cohort c;

grant select on public.v_member_cohort to authenticated;

-- ============================================================================
-- 4. PAR-Q expiry reads gyms.parq_expiry_days
-- ============================================================================

create or replace function public._book_class_for(
  p_session_id uuid,
  p_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sess           public.class_sessions;
  current_count  int;
  v_booking_id   uuid;
  v_archived_at  timestamptz;
  v_active_q     uuid;
  v_last_resp    public.parq_responses%rowtype;
  v_active_w     uuid;
  v_has_sig      boolean;
  v_parq_days    integer;
begin
  if p_profile_id is null then
    raise exception 'No profile to book for';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

  if not exists (
    select 1 from public.gym_memberships
    where gym_id = sess.gym_id
      and profile_id = p_profile_id
      and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  select archived_at into v_archived_at
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  select parq_expiry_days into v_parq_days from public.gyms where id = sess.gym_id;
  v_parq_days := coalesce(v_parq_days, 365);

  select id into v_active_q
    from public.parq_questionnaires
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_q is not null then
    select * into v_last_resp
      from public.parq_responses
      where gym_id = sess.gym_id and profile_id = p_profile_id
      order by completed_at desc
      limit 1;
    if v_last_resp.id is null
       or v_last_resp.questionnaire_id <> v_active_q
       or v_last_resp.completed_at < (now() - make_interval(days => v_parq_days))
    then
      raise exception
        'PAR-Q required: complete the health screening before booking';
    end if;
  end if;

  select id into v_active_w
    from public.waiver_documents
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_w is not null then
    select exists (
      select 1 from public.waiver_signatures
      where gym_id = sess.gym_id
        and profile_id = p_profile_id
        and waiver_id = v_active_w
    ) into v_has_sig;
    if not v_has_sig then
      raise exception
        'Waiver required: sign the waiver before booking';
    end if;
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;

  if current_count >= sess.capacity then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (sess.gym_id, p_session_id, p_profile_id)
  on conflict (class_session_id, profile_id) do nothing
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke execute on function public._book_class_for(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.current_parq_state(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  active_questionnaire_id uuid,
  last_response_id        uuid,
  last_completed_at       timestamptz,
  last_had_flag           boolean,
  needs_parq              boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active        uuid;
  v_response      public.parq_responses%rowtype;
  v_parq_days     integer;
  v_expired_after interval;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile_id
     and not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  select parq_expiry_days into v_parq_days from public.gyms where id = p_gym_id;
  v_expired_after := make_interval(days => coalesce(v_parq_days, 365));

  select id into v_active
    from public.parq_questionnaires
    where gym_id = p_gym_id and is_active
    limit 1;

  select * into v_response
    from public.parq_responses r
    where r.gym_id = p_gym_id and r.profile_id = p_profile_id
    order by completed_at desc
    limit 1;

  active_questionnaire_id := v_active;
  last_response_id        := v_response.id;
  last_completed_at       := v_response.completed_at;
  last_had_flag           := v_response.has_flag;

  if v_active is null then
    needs_parq := false;
  elsif v_response.id is null then
    needs_parq := true;
  elsif v_response.questionnaire_id <> v_active then
    needs_parq := true;
  elsif v_response.completed_at < (now() - v_expired_after) then
    needs_parq := true;
  else
    needs_parq := false;
  end if;

  return next;
end;
$$;

grant execute on function public.current_parq_state(uuid, uuid)
  to authenticated;

-- ============================================================================
-- 5. Health-data retention reads gyms.health_retention_months
-- ============================================================================

create or replace function public.purge_expired_health_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select gm.gym_id, gm.profile_id, g.health_retention_months
    from public.gym_memberships gm
    join public.gyms g on g.id = gm.gym_id
    where gm.left_at is not null
      and gm.left_at < now() - make_interval(months => coalesce(g.health_retention_months, 3))
      and (
        gm.health_flag
        or gm.par_q_id is not null
        or gm.emergency_contact is not null
        or exists (
          select 1 from public.parq_responses r
          where r.gym_id = gm.gym_id and r.profile_id = gm.profile_id
        )
        or exists (
          select 1 from public.member_injuries mi
          where mi.gym_id = gm.gym_id and mi.profile_id = gm.profile_id
        )
        or exists (
          select 1 from public.member_consents mc
          where mc.gym_id = gm.gym_id and mc.profile_id = gm.profile_id
        )
      )
  loop
    perform public._erase_member_health_data(
      v_row.gym_id, v_row.profile_id, 'purge');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.purge_expired_health_data() to authenticated;

-- ============================================================================
-- 6. set_gym_operating_defaults — the Operating defaults settings card
-- ============================================================================

create or replace function public.set_gym_operating_defaults(
  p_gym_id                         uuid,
  p_week_starts_on                 text,
  p_timezone                       text,
  p_default_class_capacity         integer,
  p_default_class_minutes          integer,
  p_expiring_within_days           integer,
  p_parq_expiry_days               integer,
  p_health_retention_months        integer,
  p_lead_conversion_window_days    integer,
  p_materialisation_horizon_weeks  integer,
  p_subscription_resolution        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  update public.gyms
    set week_starts_on                  = p_week_starts_on,
        timezone                        = p_timezone,
        default_class_capacity          = p_default_class_capacity,
        default_class_minutes           = p_default_class_minutes,
        expiring_within_days            = p_expiring_within_days,
        parq_expiry_days                = p_parq_expiry_days,
        health_retention_months         = p_health_retention_months,
        lead_conversion_window_days     = p_lead_conversion_window_days,
        materialisation_horizon_weeks   = p_materialisation_horizon_weeks,
        subscription_resolution         = p_subscription_resolution
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer,
  integer, integer, text
) to authenticated;

commit;
