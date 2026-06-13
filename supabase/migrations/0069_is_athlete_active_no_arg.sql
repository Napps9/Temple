-- QA hardening: is_athlete_active took an arbitrary p_profile_id and
-- was granted to authenticated, so any signed-in user could probe
-- whether another profile holds a solo-tracking subscription. It is
-- only ever called with the caller's own id (the RLS solo-insert
-- disjunct and both app reads pass auth.uid()), so collapse it to a
-- no-arg form that reads auth.uid() internally — there's no longer any
-- way to ask about someone else.

begin;

-- 1. New no-arg form.
create or replace function public.is_athlete_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.athlete_subscriptions
    where profile_id = auth.uid()
      and status = 'active'
      and (current_period_end is null or current_period_end > now())
  );
$$;
grant execute on function public.is_athlete_active() to authenticated;

-- 2. Repoint the tracking solo-insert/update policies at the no-arg form.
drop policy if exists tracked_workouts_self_insert on public.tracked_workouts;
create policy tracked_workouts_self_insert on public.tracked_workouts
  for insert with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active())
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
      or (gym_id is null and public.is_athlete_active())
    )
  );

drop policy if exists tracked_movement_results_self_insert on public.tracked_movement_results;
create policy tracked_movement_results_self_insert on public.tracked_movement_results
  for insert with check (
    profile_id = auth.uid()
    and (
      public.user_belongs_to(gym_id)
      or (gym_id is null and public.is_athlete_active())
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
      or (gym_id is null and public.is_athlete_active())
    )
  );

-- 3. Drop the arbitrary-id form now that nothing references it.
drop function if exists public.is_athlete_active(uuid);

commit;
