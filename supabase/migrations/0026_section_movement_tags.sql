-- PR 3 of the Programming + Tracking refactor: post-hoc movement
-- tagging on workout sections.
--
-- After a member logs a section (PR 2's structured entries), they can
-- attach one or more movement tags so the PR feeds into the
-- per-movement Journal and best-of without forcing variation-picking
-- at upload time. movement_key + optional track_key reference the
-- static catalog in src/lib/movements.ts; the keys are persisted as
-- text so the catalog can evolve without a schema change.
--
-- performed_at is denormalised from the parent workout so the
-- (profile_id, movement_key, performed_at) index can answer "show me
-- every Back Squat I've ever done" cheaply, without a join through
-- sections → workouts.
--
-- RLS uses effective_can(can_see_workout_logs), keeping the gate
-- consistent with the four tables PR 2 unified.

create table public.tracked_section_movement_tags (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  section_id    uuid not null references public.tracked_workout_sections(id) on delete cascade,
  movement_key  text not null,
  track_key     text,
  performed_at  timestamptz not null,
  notes         text,
  created_at    timestamptz not null default now()
);

create index tracked_section_movement_tags_member_movement_idx
  on public.tracked_section_movement_tags
     (profile_id, movement_key, performed_at desc);

create index tracked_section_movement_tags_section_idx
  on public.tracked_section_movement_tags (section_id);

create index tracked_section_movement_tags_gym_movement_idx
  on public.tracked_section_movement_tags (gym_id, movement_key);

alter table public.tracked_section_movement_tags enable row level security;

create policy tracked_section_movement_tags_self_or_staff_select
  on public.tracked_section_movement_tags
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_section_movement_tags_self_insert
  on public.tracked_section_movement_tags
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_section_movement_tags_self_update
  on public.tracked_section_movement_tags
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_section_movement_tags_self_delete
  on public.tracked_section_movement_tags
  for delete using (profile_id = auth.uid());
