-- 0238: What is waiting for you
--
-- 0237 put the training record behind the athlete tier, which is what the
-- owner wants sold. It also, on its own, breaks the screen that sells it.
--
-- /athlete reads tracked_workouts and tracked_movement_results DIRECTLY to
-- show somebody what they have logged, and that read is now refused for
-- exactly the person the screen exists to convert. Left as it stands, a
-- member who leaves a gym opens the athlete page, is told "your workout
-- history is yours — it stays here", and sees nothing. The pitch and the
-- evidence contradict each other, and the evidence wins.
--
-- So: a summary that does not follow the subscription. It answers the only
-- question that matters before you pay — HOW MUCH OF MY TRAINING IS
-- WAITING — and nothing else. No workout, no result, no date of any single
-- session: counts, a range, and how many gyms it spans.
--
-- Definer for the same reason export_my_training_history is: it has to
-- answer when the policies do not. No arguments and keyed on auth.uid(),
-- so there is no shape of the call that counts somebody else's training.
-- That matters more here than for the export, because a count is exactly
-- the kind of thing that looks harmless to parameterise later.

begin;

create or replace function public.my_training_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.tracked_workouts
                  where profile_id = auth.uid()),
    'results',  (select count(*) from public.tracked_movement_results
                  where profile_id = auth.uid()),
    'races',    (select count(*) from public.tracked_hyrox_races
                  where profile_id = auth.uid()),
    'gyms',     (select count(distinct gym_id) from public.tracked_workouts
                  where profile_id = auth.uid() and gym_id is not null),
    'first_at', (select min(performed_at) from public.tracked_workouts
                  where profile_id = auth.uid()),
    'last_at',  (select max(performed_at) from public.tracked_workouts
                  where profile_id = auth.uid())
  );
$$;

revoke all on function public.my_training_summary() from public, anon;
grant execute on function public.my_training_summary() to authenticated;

commit;
