-- Members can track workouts and individual movement results (PRs and
-- rep maxes). The "Track" area on the member side reads from these
-- two tables.
--
-- tracked_workouts is the chronological journal entry — one row per
-- session a member logs. tracked_movement_results holds the actual
-- numbers (1RM, 5K time, max reps etc) tied back to the workout via
-- workout_id, and indexed on (profile_id, movement_key) so the
-- per-movement detail page can scan a member's history for a single
-- movement cheaply.
--
-- The catalog of movements and their tracked schemes (Back Squat /
-- 1RM, Running / 5K Time, ...) lives in src/lib/movements.ts. Storing
-- it in TypeScript keeps the data model small: this migration only
-- needs to know that movement_key + track_key are free-form strings.
--
-- RLS: members manage their own rows. Admin / coach can read members'
-- rows for coaching context but cannot edit or delete them.

create table public.tracked_workouts (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  class_session_id  uuid references public.class_sessions(id) on delete set null,
  performed_at      timestamptz not null default now(),
  title             text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index tracked_workouts_member_performed_idx
  on public.tracked_workouts (profile_id, performed_at desc);

create index tracked_workouts_gym_performed_idx
  on public.tracked_workouts (gym_id, performed_at desc);

create index tracked_workouts_class_session_idx
  on public.tracked_workouts (class_session_id)
  where class_session_id is not null;

create table public.tracked_movement_results (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  workout_id    uuid not null references public.tracked_workouts(id) on delete cascade,
  movement_key  text not null,
  track_key     text not null,
  -- Exactly one of these carries the value; which one depends on the
  -- scheme's metric (defined in code). value_unit is informational
  -- (e.g. 'kg', 'lbs', 'cal', 'm') and only meaningful for the
  -- corresponding metric.
  value_numeric numeric,
  value_seconds int,
  value_unit    text,
  notes         text,
  performed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index tracked_movement_results_member_movement_idx
  on public.tracked_movement_results (profile_id, movement_key, performed_at desc);

create index tracked_movement_results_workout_idx
  on public.tracked_movement_results (workout_id);

create index tracked_movement_results_gym_movement_idx
  on public.tracked_movement_results (gym_id, movement_key);

alter table public.tracked_workouts enable row level security;
alter table public.tracked_movement_results enable row level security;

-- Members see their own; admin / coach can see members' for coaching.
create policy tracked_workouts_self_or_staff_select on public.tracked_workouts
  for select using (
    profile_id = auth.uid()
    or public.user_can_admin_or_coach(gym_id)
  );

create policy tracked_workouts_self_insert on public.tracked_workouts
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_workouts_self_update on public.tracked_workouts
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_workouts_self_delete on public.tracked_workouts
  for delete using (profile_id = auth.uid());

create policy tracked_movement_results_self_or_staff_select on public.tracked_movement_results
  for select using (
    profile_id = auth.uid()
    or public.user_can_admin_or_coach(gym_id)
  );

create policy tracked_movement_results_self_insert on public.tracked_movement_results
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_movement_results_self_update on public.tracked_movement_results
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_movement_results_self_delete on public.tracked_movement_results
  for delete using (profile_id = auth.uid());
