-- 0237: Training history follows the athlete tier
--
-- Athlete mode (0068/0069) already sells the right thing: a member who
-- leaves a gym, or who never joined one, keeps logging their own training
-- under an athlete subscription, and a solo workout carries gym_id = NULL.
-- What it never gated was the RECORD. Two holes, both verified against a
-- membership closed ninety days ago rather than reasoned about:
--
--   1. user_belongs_to has no left_at guard, and it is the write half of
--      every tracked_* insert policy. So somebody who left kept logging
--      workouts ATTRIBUTED TO THE GYM THEY LEFT — free, bypassing the tier
--      entirely, and dropping their new training into that gym's
--      staff-visible history where it does not belong.
--   2. The read half is `profile_id = auth.uid()` with no condition at
--      all, so the whole history stayed browsable forever whether or not
--      anybody was paying for it.
--
-- The owner's call is that the history is part of what the tier sells. So
-- the self branch now asks for one of two things: current membership of
-- the gym the row belongs to, or an active athlete subscription. A member
-- in a gym is unaffected — they see everything, as now. Somebody who
-- leaves keeps everything the moment they subscribe, and the rows are
-- never touched either way.
--
-- ARTICLE 15 IS NOT SATISFIED BY A SUBSCRIPTION, so this migration also
-- ships the route that is. export_my_training_history() returns the
-- caller's own record in full, free, regardless of tier or membership —
-- the right of access is a legal obligation and cannot sit behind a
-- payment. What the tier sells is the product: browsing it, the PR pages,
-- the sparklines, the leaderboards, and continuing to add to it. What it
-- cannot sell is your data back to you.

begin;

-- ============================================================================
-- 1. The write half: left means left here too
-- ============================================================================
--
-- 0236 guarded every helper that grants a STAFF power and deliberately
-- left this one, because it looked like it might cut a member off from
-- their own record. It cannot: the read path never called it. All fourteen
-- of its write policies are tracked_* inserts and updates, which is the
-- gym-attributed logging that should stop when somebody leaves.

create or replace function public.user_belongs_to(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
  );
$$;

-- ============================================================================
-- 2. The read half: current member, or paying athlete
-- ============================================================================
--
-- Seven tables carry a gym_id and a history worth reading. The staff
-- branch is untouched — effective_can already refuses somebody who left.
-- The two favourites tables are preferences rather than a record and stay
-- plain profile-keyed.

drop policy tracked_workouts_self_or_staff_select on public.tracked_workouts;
create policy tracked_workouts_self_or_staff_select on public.tracked_workouts
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_movement_results_self_or_staff_select
  on public.tracked_movement_results;
create policy tracked_movement_results_self_or_staff_select
  on public.tracked_movement_results
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_workout_sections_self_or_staff_select
  on public.tracked_workout_sections;
create policy tracked_workout_sections_self_or_staff_select
  on public.tracked_workout_sections
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_section_entries_self_or_staff_select
  on public.tracked_section_entries;
create policy tracked_section_entries_self_or_staff_select
  on public.tracked_section_entries
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_section_movement_tags_self_or_staff_select
  on public.tracked_section_movement_tags;
create policy tracked_section_movement_tags_self_or_staff_select
  on public.tracked_section_movement_tags
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_hyrox_races_self_or_staff_select
  on public.tracked_hyrox_races;
create policy tracked_hyrox_races_self_or_staff_select
  on public.tracked_hyrox_races
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

drop policy tracked_hyrox_splits_self_or_staff_select
  on public.tracked_hyrox_splits;
create policy tracked_hyrox_splits_self_or_staff_select
  on public.tracked_hyrox_splits
  for select using (
    (profile_id = auth.uid()
      and (public.user_belongs_to(gym_id) or public.is_athlete_active()))
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

-- ============================================================================
-- 3. The right of access, which is not for sale
-- ============================================================================
--
-- Definer so it reads past the policies above: the whole point is that it
-- answers when the product does not. It takes no arguments and keys on
-- auth.uid(), so it can only ever return the caller's own record — there
-- is no shape of this call that reads somebody else's training.
--
-- Returns the workouts with their sections, entries and movement results
-- nested, plus races and splits: the same rows the app would render, in
-- one document a person can keep. Deliberately not paginated — a subject
-- access request is answered in full or it is not answered.

create or replace function public.export_my_training_history()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile_id', auth.uid(),
    'note', 'Your complete training record. Free of charge and independent '
         || 'of any subscription — this is your right of access, not a '
         || 'product feature.',
    'workouts', coalesce((
      select jsonb_agg(w order by w.performed_at desc)
        from (
          select tw.*,
                 coalesce((
                   select jsonb_agg(to_jsonb(ts) order by ts.sort_order)
                     from public.tracked_workout_sections ts
                    where ts.workout_id = tw.id
                 ), '[]'::jsonb) as sections,
                 coalesce((
                   select jsonb_agg(to_jsonb(tr) order by tr.performed_at)
                     from public.tracked_movement_results tr
                    where tr.workout_id = tw.id
                 ), '[]'::jsonb) as movement_results
            from public.tracked_workouts tw
           where tw.profile_id = auth.uid()
        ) w
    ), '[]'::jsonb),
    'hyrox_races', coalesce((
      select jsonb_agg(jsonb_build_object(
               'race', to_jsonb(hr),
               'splits', coalesce((
                 select jsonb_agg(to_jsonb(hs) order by hs.segment_index)
                   from public.tracked_hyrox_splits hs
                  where hs.race_id = hr.id
               ), '[]'::jsonb)))
        from public.tracked_hyrox_races hr
       where hr.profile_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.export_my_training_history() from public, anon;
grant execute on function public.export_my_training_history() to authenticated;

commit;
