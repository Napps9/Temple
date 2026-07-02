-- Hyrox Phase 2: the split-by-split race simulation builder. Phase 1
-- (0023 tracked_movement_results, movement_key='hyrox_sim') only ever
-- logged a single finish time per full/half attempt. This adds the
-- detailed breakdown a coach times during an in-gym simulation: the 8
-- run splits, 8 station splits, and 8 roxzone (transition) times that
-- make up a race, plus the category it was run under.
--
-- tracked_hyrox_races is the parent — one row per logged simulation,
-- linked to a tracked_workouts row exactly like tracked_workout_sections
-- (0025) so it shows up in the ordinary workout journal. The aggregate
-- totals are stored (not just derivable from the splits) so the rest
-- of the app — PR badges, sparklines, leaderboards — can keep reading
-- a single tracked_movement_results row per race, written alongside
-- this one from the client in the same request; this table is the
-- detail view underneath it, not a replacement for it.
--
-- tracked_hyrox_splits is the grandchild — one row per timed segment.
-- gym_id/profile_id are denormalized here the same way
-- tracked_section_entries denormalizes them off tracked_workout_sections
-- (0025) — RLS reads them directly instead of joining through race_id.
--
-- race_type / division / gender_category / age_group are left as plain
-- text with no CHECK, same reasoning as section_category/section_format
-- in 0025: they're a catalog (src/lib/hyrox.ts) that may grow (Hyrox
-- has added divisions before), so a forward-rolled catalog value
-- shouldn't need a schema migration. race_length, segment_type and
-- segment_index ARE constrained — they're fixed by the shape of the
-- race itself (full/half, and exactly 8 of each segment kind), not a
-- growable catalog.

begin;

create table public.tracked_hyrox_races (
  id                    uuid primary key default gen_random_uuid(),
  gym_id                uuid not null references public.gyms(id) on delete cascade,
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  workout_id            uuid not null references public.tracked_workouts(id) on delete cascade,
  race_length           text not null check (race_length in ('full','half')),
  race_type             text not null default 'singles',
  division              text not null default 'open',
  gender_category       text not null,
  age_group             text,
  run_total_seconds     int not null check (run_total_seconds >= 0),
  station_total_seconds int not null check (station_total_seconds >= 0),
  roxzone_total_seconds int not null check (roxzone_total_seconds >= 0),
  total_seconds         int not null check (total_seconds >= 0),
  performed_at          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index tracked_hyrox_races_member_idx
  on public.tracked_hyrox_races (profile_id, performed_at desc);
create index tracked_hyrox_races_gym_idx
  on public.tracked_hyrox_races (gym_id);
create index tracked_hyrox_races_workout_idx
  on public.tracked_hyrox_races (workout_id);

create table public.tracked_hyrox_splits (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  race_id       uuid not null references public.tracked_hyrox_races(id) on delete cascade,
  segment_type  text not null check (segment_type in ('run','station','roxzone')),
  segment_index int not null check (segment_index between 1 and 8),
  station_key   text,
  time_seconds  int not null check (time_seconds >= 0),
  created_at    timestamptz not null default now()
);

create index tracked_hyrox_splits_race_idx
  on public.tracked_hyrox_splits (race_id, segment_type, segment_index);
create index tracked_hyrox_splits_member_idx
  on public.tracked_hyrox_splits (profile_id);
create index tracked_hyrox_splits_gym_idx
  on public.tracked_hyrox_splits (gym_id);

alter table public.tracked_hyrox_races enable row level security;
alter table public.tracked_hyrox_splits enable row level security;

create policy tracked_hyrox_races_self_or_staff_select on public.tracked_hyrox_races
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_hyrox_races_self_insert on public.tracked_hyrox_races
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_hyrox_races_self_update on public.tracked_hyrox_races
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_hyrox_races_self_delete on public.tracked_hyrox_races
  for delete using (profile_id = auth.uid());

create policy tracked_hyrox_splits_self_or_staff_select on public.tracked_hyrox_splits
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_hyrox_splits_self_insert on public.tracked_hyrox_splits
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_hyrox_splits_self_update on public.tracked_hyrox_splits
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_hyrox_splits_self_delete on public.tracked_hyrox_splits
  for delete using (profile_id = auth.uid());

commit;
