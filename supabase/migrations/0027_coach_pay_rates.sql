-- Coach earnings — per-coach × per-class-type rates, with a gym-level
-- credit policy and an RPC that resolves earnings for a period.
--
-- Schema rationale:
--   coach_pay_rates is keyed on (gym_id, profile_id, class_type_id)
--     so a coach can be paid differently for CrossFit vs Open Gym
--     vs Hyrox. A class type with no rate row for a given coach
--     contributes £0 to earnings — which means owners need to
--     explicitly add rates, never accidentally "default-pay" zero.
--   gyms.coach_credit_policy lets the owner choose what counts as
--     a "taught" class: every past scheduled session, or only
--     those where the coach also marked attendance. Stored on
--     gyms so it's one rule per gym; per-coach rules can come
--     later if it's a real need.
--   gyms.currency is added here too so earnings can render with
--     the right symbol; default 'GBP' matches the rest of the app.
--
-- RLS:
--   coach_pay_rates SELECT — self (the coach reading their own
--     rate) or effective_can(can_set_coach_pay).
--   coach_pay_rates WRITE — effective_can(can_set_coach_pay).
--   gyms credit_policy + currency — owner-only (the existing
--     gym_memberships_owner_update policy isn't tight enough; we
--     route writes through an RPC instead).
--
-- The compute_coach_earnings RPC is security-definer so it can JOIN
-- across class_sessions + class_bookings + gym_memberships without
-- caller-side RLS getting in the way. The function checks
-- authorisation up front: caller must be the coach themselves, OR
-- effective_can(can_set_coach_pay).

begin;

-- ============================================================================
-- 1. gyms columns: coach_credit_policy + currency
-- ============================================================================

alter table public.gyms
  add column if not exists coach_credit_policy text not null default 'all_scheduled'
    check (coach_credit_policy in ('all_scheduled', 'only_checked_in')),
  add column if not exists currency text not null default 'GBP';

-- ============================================================================
-- 2. Register can_set_coach_pay (owner-only default)
-- ============================================================================

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    else false
  end;
$$;

-- ============================================================================
-- 3. coach_pay_rates
-- ============================================================================

create table public.coach_pay_rates (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  class_type_id   uuid not null references public.class_types(id) on delete cascade,
  per_class_cents integer not null check (per_class_cents >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (gym_id, profile_id, class_type_id),
  -- The (gym, profile) pair must reference an existing membership so
  -- a rate can't dangle on a coach who's been removed from the gym.
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index coach_pay_rates_coach_idx
  on public.coach_pay_rates (gym_id, profile_id);

alter table public.coach_pay_rates enable row level security;

create policy coach_pay_rates_self_or_owner_select on public.coach_pay_rates
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_set_coach_pay')
  );

create policy coach_pay_rates_owner_insert on public.coach_pay_rates
  for insert with check (public.effective_can(gym_id, 'can_set_coach_pay'));

create policy coach_pay_rates_owner_update on public.coach_pay_rates
  for update
  using (public.effective_can(gym_id, 'can_set_coach_pay'))
  with check (public.effective_can(gym_id, 'can_set_coach_pay'));

create policy coach_pay_rates_owner_delete on public.coach_pay_rates
  for delete using (public.effective_can(gym_id, 'can_set_coach_pay'));

-- ============================================================================
-- 4. set_coach_credit_policy RPC — owner-only write to gyms column
-- ============================================================================

create or replace function public.set_coach_credit_policy(
  p_gym_id uuid,
  p_policy text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_policy not in ('all_scheduled', 'only_checked_in') then
    raise exception 'Unknown coach credit policy: %', p_policy;
  end if;
  if not public.effective_can(p_gym_id, 'can_set_coach_pay') then
    raise exception 'Not authorised';
  end if;
  update public.gyms
    set coach_credit_policy = p_policy
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_coach_credit_policy(uuid, text) to authenticated;

-- ============================================================================
-- 5. compute_coach_earnings RPC
-- ============================================================================
--
-- Returns per-class-type counts + earnings for the (coach, period).
-- Includes class types with zero classes coached when the coach has
-- a rate set, so the owner can see "rate is configured, but you taught
-- 0 of these last month."
--
-- Caller authorisation:
--   - the coach themselves (own earnings)
--   - effective_can(can_set_coach_pay) (owner / admin if granted)

create or replace function public.compute_coach_earnings(
  p_gym_id       uuid,
  p_coach_id     uuid,
  p_period_start timestamptz,
  p_period_end   timestamptz
) returns table (
  class_type_id     uuid,
  class_type_name   text,
  class_type_color  text,
  class_count       integer,
  rate_cents        integer,
  earnings_cents    integer,
  currency          text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_policy text;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_coach_id and not public.effective_can(p_gym_id, 'can_set_coach_pay') then
    raise exception 'Not authorised';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'Period end must be after period start';
  end if;

  select g.coach_credit_policy, g.currency
    into v_policy, v_currency
    from public.gyms g
    where g.id = p_gym_id;

  if v_policy is null then
    raise exception 'Gym not found';
  end if;

  return query
  with credited as (
    select s.class_type_id, s.id as session_id
    from public.class_sessions s
    where s.gym_id = p_gym_id
      and s.coach_id = p_coach_id
      and s.starts_at >= p_period_start
      and s.starts_at < p_period_end
      and s.starts_at < now()
      and (
        v_policy = 'all_scheduled'
        or exists (
          select 1 from public.class_bookings b
          where b.class_session_id = s.id
            and b.marked_by = p_coach_id
            and (b.attended_at is not null or b.no_show)
        )
      )
  ),
  -- One row per class type the coach either taught in the period
  -- OR has a rate set for. Aggregates can be 0 for the rate-only
  -- side.
  per_type as (
    select
      ct.id   as class_type_id,
      ct.name as class_type_name,
      ct.color as class_type_color,
      count(c.session_id)::int as class_count,
      coalesce(r.per_class_cents, 0) as rate_cents
    from public.class_types ct
    left join credited c on c.class_type_id = ct.id
    left join public.coach_pay_rates r
      on r.gym_id = p_gym_id
     and r.profile_id = p_coach_id
     and r.class_type_id = ct.id
    where ct.gym_id = p_gym_id
      and (
        r.id is not null
        or c.session_id is not null
      )
    group by ct.id, ct.name, ct.color, r.per_class_cents
  )
  select
    p.class_type_id,
    p.class_type_name,
    p.class_type_color,
    p.class_count,
    p.rate_cents,
    (p.class_count * p.rate_cents)::int as earnings_cents,
    v_currency as currency
  from per_type p
  order by p.class_type_name;
end;
$$;

grant execute on function public.compute_coach_earnings(uuid, uuid, timestamptz, timestamptz) to authenticated;

commit;
