-- Athlete mode increment 2 — solo (gymless) workout logging behind a
-- paid athlete tier.
--
-- A member who leaves a gym (or never joined one) can keep logging
-- their own training under an athlete subscription. The subscription
-- is the entitlement that gates solo logging; for the beta it
-- self-activates free (source = 'beta', no payment collected — the
-- platform has no billing rails yet). When the payments phase lands,
-- the activation step flips to require a charge and the `source` /
-- `current_period_end` columns carry the billing state. Nothing else
-- about the gate changes.
--
-- Data shape: a "solo" workout (and its movement results) has
-- gym_id = NULL. Gym-logged data is unchanged. Solo rows are visible
-- only to the athlete (the tracking self-select branch is
-- profile-keyed; user_can_admin_or_coach(NULL) is false, so no gym's
-- coaches ever see another person's solo history).

begin;

-- ============================================================================
-- 1. Allow gym-less (solo) tracked workouts + results
-- ============================================================================

alter table public.tracked_workouts          alter column gym_id drop not null;
alter table public.tracked_movement_results  alter column gym_id drop not null;

-- ============================================================================
-- 2. athlete_subscriptions — the entitlement
-- ============================================================================

create table public.athlete_subscriptions (
  profile_id          uuid primary key references public.profiles(id) on delete cascade,
  status              text not null default 'active'
                        check (status in ('active', 'cancelled')),
  -- Where the entitlement came from. 'beta' = free self-activation;
  -- billing providers slot in here later without a schema change.
  source              text not null default 'beta',
  activated_at        timestamptz not null default now(),
  -- NULL = open-ended (beta). Billing sets a period end the predicate
  -- enforces.
  current_period_end  timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.athlete_subscriptions enable row level security;

-- The athlete reads their own row; all writes go through the RPCs.
create policy athlete_subscriptions_self_select on public.athlete_subscriptions
  for select using (profile_id = auth.uid());

create or replace function public._athlete_subscriptions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger athlete_subscriptions_touch_updated_at_trg
  before update on public.athlete_subscriptions
  for each row execute function public._athlete_subscriptions_touch_updated_at();

-- ============================================================================
-- 3. is_athlete_active — the predicate RLS + the app read
-- ============================================================================

create or replace function public.is_athlete_active(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.athlete_subscriptions
    where profile_id = p_profile_id
      and status = 'active'
      and (current_period_end is null or current_period_end > now())
  );
$$;
grant execute on function public.is_athlete_active(uuid) to authenticated;

-- ============================================================================
-- 4. start / cancel RPCs
-- ============================================================================
--
-- start_athlete_subscription is the free-during-beta activation. It is
-- intentionally the single seam billing will replace: when payments
-- ship, this body takes a verified charge before flipping the row to
-- active (source = '<provider>', current_period_end set).

create or replace function public.start_athlete_subscription()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.athlete_subscriptions
    (profile_id, status, source, activated_at, current_period_end, cancelled_at)
  values (v_uid, 'active', 'beta', now(), null, null)
  on conflict (profile_id) do update
    set status             = 'active',
        source             = 'beta',
        activated_at        = now(),
        current_period_end  = null,
        cancelled_at        = null;
end;
$$;
grant execute on function public.start_athlete_subscription() to authenticated;

create or replace function public.cancel_athlete_subscription()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  update public.athlete_subscriptions
    set status = 'cancelled', cancelled_at = now()
    where profile_id = v_uid;
end;
$$;
grant execute on function public.cancel_athlete_subscription() to authenticated;

-- ============================================================================
-- 5. Extend the tracking insert/update policies with the solo path
-- ============================================================================
--
-- Existing path (log into a gym you belong to) is preserved verbatim;
-- the new disjunct allows a gym-less (NULL gym_id) row when the caller
-- holds an active athlete subscription.

drop policy if exists tracked_workouts_self_insert on public.tracked_workouts;
create policy tracked_workouts_self_insert on public.tracked_workouts
  for insert with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active(auth.uid()))
    )
  );

drop policy if exists tracked_workouts_self_update on public.tracked_workouts;
create policy tracked_workouts_self_update on public.tracked_workouts
  for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active(auth.uid()))
    )
  );

drop policy if exists tracked_movement_results_self_insert on public.tracked_movement_results;
create policy tracked_movement_results_self_insert on public.tracked_movement_results
  for insert with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active(auth.uid()))
    )
  );

drop policy if exists tracked_movement_results_self_update on public.tracked_movement_results;
create policy tracked_movement_results_self_update on public.tracked_movement_results
  for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active(auth.uid()))
    )
  );

commit;
