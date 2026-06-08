-- PR 2 of the Programming + Tracking refactor: workout-log capability,
-- the section + entries tables, and the RLS rewrite that pulls 0023
-- onto the same capability gate.
--
-- Non-negotiable build constraint: the can_see_workout_logs default
-- is registered (in default_capability) BEFORE any policy that calls
-- effective_can(..., 'can_see_workout_logs') is created. Drop +
-- recreate inside one transaction so an interrupted migration leaves
-- the old policies intact rather than locking staff out.

begin;

-- ============================================================================
-- 1. Register can_see_workout_logs in default_capability
-- ============================================================================
--
-- Default ON for admin / coach (mirroring 0023's
-- user_can_admin_or_coach gate). Staff (front desk) is excluded by
-- default since their job is check-in, not coaching. An owner is
-- short-circuited to true in effective_can and never reaches here.

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
    else false
  end;
$$;

-- ============================================================================
-- 2. Rewrite 0023's staff-read policies to use effective_can
-- ============================================================================
--
-- The drop+recreate must stay inside this transaction so a partial
-- failure leaves the old policy intact rather than ungated.

drop policy if exists tracked_workouts_self_or_staff_select
  on public.tracked_workouts;
drop policy if exists tracked_movement_results_self_or_staff_select
  on public.tracked_movement_results;

create policy tracked_workouts_self_or_staff_select on public.tracked_workouts
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_movement_results_self_or_staff_select
  on public.tracked_movement_results
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

-- ============================================================================
-- 3. tracked_workout_sections — one row per logged section of a workout
-- ============================================================================
--
-- A workout has many sections. Each section snapshots the programmed
-- title and body so member-side journal renders correctly even after
-- the coach edits a future day's programming. source_programming_id
-- is the optional back-reference to the class_programming row that
-- pre-filled this section (PR 3).
--
-- section_category and section_format keys match the shape in
-- src/lib/programming.ts; persisted as text so a forward-rolled
-- catalog doesn't require a schema change.
--
-- Aggregate columns are nullable; format decides which to populate:
--   for_time / amrap / max_load → aggregate-first (entries optional)
--   emom / intervals / strength_sets → entries-only (aggregates NULL)
--   other → free_text_result only
--   no_score → everything NULL except the always-on notes
--
-- This is the "aggregate invariant" — see the plan's non-negotiable
-- build constraints. Never populate both aggregates AND entries —
-- they drift.

create table public.tracked_workout_sections (
  id                    uuid primary key default gen_random_uuid(),
  gym_id                uuid not null references public.gyms(id) on delete cascade,
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  workout_id            uuid not null references public.tracked_workouts(id) on delete cascade,
  source_programming_id uuid references public.class_programming(id) on delete set null,
  section_category      text not null,
  section_format        text not null,
  title                 text,
  body                  text,
  notes                 text,
  sort_order            int not null default 0,
  total_time_seconds    int,
  total_rounds          int,
  total_extra_reps      int,
  did_not_finish        bool,
  free_text_result      text,
  created_at            timestamptz not null default now()
);

create index tracked_workout_sections_workout_idx
  on public.tracked_workout_sections (workout_id, sort_order);
create index tracked_workout_sections_member_idx
  on public.tracked_workout_sections (profile_id);
create index tracked_workout_sections_gym_idx
  on public.tracked_workout_sections (gym_id);
create index tracked_workout_sections_source_idx
  on public.tracked_workout_sections (source_programming_id)
  where source_programming_id is not null;

alter table public.tracked_workout_sections enable row level security;

create policy tracked_workout_sections_self_or_staff_select
  on public.tracked_workout_sections
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_workout_sections_self_insert
  on public.tracked_workout_sections
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_workout_sections_self_update
  on public.tracked_workout_sections
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_workout_sections_self_delete
  on public.tracked_workout_sections
  for delete using (profile_id = auth.uid());

-- ============================================================================
-- 4. tracked_section_entries — the per-row data inside a section
-- ============================================================================
--
-- One ordered row of structured data inside a section. The format
-- decides which optional metric columns are populated and how the UI
-- labels the row ("Set 3" vs "Round 5" vs "Minute 2"). All metric
-- columns are nullable so a single shape absorbs every format.
--
-- entry_index orders sets (Strength sets, Max load warm-ups).
-- round_index orders rounds (EMOM, Intervals, optional AMRAP per-
-- round). Sections that don't use rounds leave round_index null.
--
-- See src/lib/track-sections.ts for which columns the UI prompts per
-- format.

create table public.tracked_section_entries (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  section_id          uuid not null references public.tracked_workout_sections(id) on delete cascade,
  entry_index         int not null,
  round_index         int,
  label               text,
  weight_numeric      numeric,
  weight_unit         text,
  reps                int,
  time_seconds        int,
  distance_numeric    numeric,
  distance_unit       text,
  calories            int,
  done                bool,
  notes               text,
  created_at          timestamptz not null default now()
);

create index tracked_section_entries_section_idx
  on public.tracked_section_entries (section_id, entry_index);
create index tracked_section_entries_member_idx
  on public.tracked_section_entries (profile_id);
create index tracked_section_entries_gym_idx
  on public.tracked_section_entries (gym_id);

alter table public.tracked_section_entries enable row level security;

create policy tracked_section_entries_self_or_staff_select
  on public.tracked_section_entries
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_workout_logs')
  );

create policy tracked_section_entries_self_insert
  on public.tracked_section_entries
  for insert with check (
    profile_id = auth.uid()
    and public.user_belongs_to(gym_id)
  );

create policy tracked_section_entries_self_update
  on public.tracked_section_entries
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.user_belongs_to(gym_id));

create policy tracked_section_entries_self_delete
  on public.tracked_section_entries
  for delete using (profile_id = auth.uid());

commit;
