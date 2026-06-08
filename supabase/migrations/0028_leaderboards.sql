-- Leaderboards foundation.
--
-- Two leaderboard surfaces:
--   1. Per-programmed-section (e.g. "Tuesday's Fran") — a coach marks
--      a section leaderboard-enabled at upload; members who log
--      against that programmed section show up ranked. The
--      tracked_workout_sections row carries source_section_index now
--      so we know WHICH section inside the programming row a log
--      came from (programming.sections is a JSONB array).
--   2. Per-movement strength leaderboards (e.g. "heaviest Back Squat
--      1RM in the gym") — unions direct PRs from
--      tracked_movement_results with section-tag rows from
--      tracked_section_movement_tags, derives the value the same way
--      the per-movement Journal does, ranks by scheme metric.
--
-- Gym-level config: class_leaderboards_enabled +
-- strength_leaderboards_enabled, both default true. Owner-only writes
-- via set_leaderboard_config RPC gated on can_configure_leaderboards.
--
-- Member privacy: gym_memberships.appear_in_leaderboards default
-- true (opt-out). RPCs exclude opted-out members from the ranked
-- output, but the member always sees their own results in the Track
-- area regardless.

begin;

-- ============================================================================
-- 1. gyms columns + gym_memberships column
-- ============================================================================

alter table public.gyms
  add column if not exists class_leaderboards_enabled    boolean not null default true,
  add column if not exists strength_leaderboards_enabled boolean not null default true;

alter table public.gym_memberships
  add column if not exists appear_in_leaderboards boolean not null default true;

-- ============================================================================
-- 2. tracked_workout_sections.source_section_index
-- ============================================================================
--
-- Nullable: ad-hoc sections (not pre-filled from programming) have no
-- index. Existing rows pre-migration also have null and won't appear
-- on per-section leaderboards — fine; new logs after the migration
-- carry the index.

alter table public.tracked_workout_sections
  add column if not exists source_section_index integer;

create index if not exists tracked_workout_sections_source_idx_full
  on public.tracked_workout_sections (source_programming_id, source_section_index)
  where source_programming_id is not null;

-- ============================================================================
-- 3. Register can_configure_leaderboards (owner-only)
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
    when 'can_configure_leaderboards' then false
    else false
  end;
$$;

-- ============================================================================
-- 4. set_appear_in_leaderboards — member-self toggle
-- ============================================================================

create or replace function public.set_appear_in_leaderboards(
  p_gym_id uuid,
  p_value  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update public.gym_memberships
    set appear_in_leaderboards = p_value
    where gym_id = p_gym_id
      and profile_id = v_uid;
end;
$$;

grant execute on function public.set_appear_in_leaderboards(uuid, boolean) to authenticated;

-- ============================================================================
-- 5. set_leaderboard_config — owner-only gym toggles
-- ============================================================================

create or replace function public.set_leaderboard_config(
  p_gym_id          uuid,
  p_class_enabled   boolean,
  p_strength_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_configure_leaderboards') then
    raise exception 'Not authorised';
  end if;
  update public.gyms
    set class_leaderboards_enabled    = p_class_enabled,
        strength_leaderboards_enabled = p_strength_enabled
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_leaderboard_config(uuid, boolean, boolean) to authenticated;

-- ============================================================================
-- 6. class_leaderboard RPC
-- ============================================================================
--
-- Returns one ranked row per member who logged the (programming_id,
-- section_index) section, scored per the section's format. The
-- caller passes the section_format so we don't have to dig into the
-- programming JSONB on the server (the client already parses it).
--
-- Scoring (descending = better unless noted):
--   for_time      — primary: -total_time_seconds (lower time first; DNF last)
--   amrap         — primary: total_rounds * 1000 + total_extra_reps
--   max_load      — primary: heaviest entry weight
--   strength_sets — primary: heaviest entry weight
--   emom          — primary: count(entries with done=true), tiebreak
--                   heaviest weight
--   intervals     — primary: count(entries with any metric set),
--                   tiebreak heaviest weight
--   no_score/other — unranked, score=0
--
-- Members with appear_in_leaderboards=false are excluded.
-- Gym must have class_leaderboards_enabled=true.

create or replace function public.class_leaderboard(
  p_programming_id uuid,
  p_section_index  integer
) returns table (
  profile_id    uuid,
  display_name  text,
  score         numeric,
  total_time_seconds int,
  total_rounds  int,
  total_extra_reps int,
  did_not_finish boolean,
  heaviest_weight numeric,
  weight_unit    text,
  section_format text,
  performed_at   timestamptz,
  rank           integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_gym uuid;
  v_enabled boolean;
begin
  select gym_id into v_gym
    from public.class_programming
    where id = p_programming_id;
  if v_gym is null then
    raise exception 'Programming row not found';
  end if;
  if not public.user_belongs_to(v_gym) then
    raise exception 'Not authorised';
  end if;
  select class_leaderboards_enabled into v_enabled
    from public.gyms where id = v_gym;
  if not v_enabled then
    return;
  end if;

  return query
  with sec as (
    select s.id, s.profile_id, s.section_format,
           s.total_time_seconds, s.total_rounds, s.total_extra_reps,
           coalesce(s.did_not_finish, false) as did_not_finish,
           coalesce(w.performed_at, s.created_at) as performed_at
    from public.tracked_workout_sections s
    join public.tracked_workouts w on w.id = s.workout_id
    join public.gym_memberships m
      on m.gym_id = s.gym_id and m.profile_id = s.profile_id
    where s.source_programming_id = p_programming_id
      and s.source_section_index = p_section_index
      and m.appear_in_leaderboards
      and m.left_at is null
  ),
  -- For sections with entries, aggregate the per-entry metrics so we
  -- can derive heuristics (heaviest weight, count of done rounds,
  -- count of filled rows).
  ent as (
    select e.section_id,
           max(e.weight_numeric) as heaviest_weight,
           max(e.weight_unit) as weight_unit,
           count(*) filter (where e.done = true) as done_rounds,
           count(*) filter (
             where e.weight_numeric is not null
                or e.reps is not null
                or e.time_seconds is not null
                or e.distance_numeric is not null
                or e.calories is not null
                or e.done is true
           ) as filled_rows
    from public.tracked_section_entries e
    where e.section_id in (select id from sec)
    group by e.section_id
  ),
  scored as (
    select
      s.profile_id,
      s.section_format,
      s.total_time_seconds,
      s.total_rounds,
      s.total_extra_reps,
      s.did_not_finish,
      coalesce(e.heaviest_weight, 0) as heaviest_weight,
      e.weight_unit,
      s.performed_at,
      case s.section_format
        when 'for_time' then
          case when s.did_not_finish or s.total_time_seconds is null then -1e9
               else (-1)::numeric * s.total_time_seconds end
        when 'amrap' then
          (coalesce(s.total_rounds, 0) * 1000
           + coalesce(s.total_extra_reps, 0))::numeric
        when 'max_load' then
          coalesce(e.heaviest_weight, 0)
        when 'strength_sets' then
          coalesce(e.heaviest_weight, 0)
        when 'emom' then
          (coalesce(e.done_rounds, 0) * 1000)::numeric
          + coalesce(e.heaviest_weight, 0)
        when 'intervals' then
          (coalesce(e.filled_rows, 0) * 1000)::numeric
          + coalesce(e.heaviest_weight, 0)
        else 0
      end as score
    from sec s
    left join ent e on e.section_id = s.id
  ),
  -- One row per member: their best score for this section (in case
  -- they logged it more than once).
  per_member as (
    select distinct on (profile_id)
      profile_id, section_format,
      total_time_seconds, total_rounds, total_extra_reps,
      did_not_finish, heaviest_weight, weight_unit,
      performed_at, score
    from scored
    order by profile_id, score desc, performed_at desc
  )
  select
    p.profile_id,
    coalesce(pr.full_name, 'Member') as display_name,
    p.score,
    p.total_time_seconds,
    p.total_rounds,
    p.total_extra_reps,
    p.did_not_finish,
    p.heaviest_weight,
    p.weight_unit,
    p.section_format,
    p.performed_at,
    rank() over (order by p.score desc)::int as rank
  from per_member p
  left join public.profiles pr on pr.id = p.profile_id
  order by p.score desc, p.performed_at asc;
end;
$$;

grant execute on function public.class_leaderboard(uuid, integer) to authenticated;

-- ============================================================================
-- 7. strength_leaderboard RPC
-- ============================================================================
--
-- Returns ranked members for (gym, movement_key, track_key). Sources:
--   - tracked_movement_results (direct PR rows)
--   - tracked_section_movement_tags joined to sections + entries
--     (derived best per section using the scheme metric)
-- p_metric: 'weight'|'time'|'reps'|'distance'|'calories'
-- p_better: 'higher' | 'lower'
--
-- The client passes both because the catalog (src/lib/movements.ts)
-- knows the scheme's metric and direction — the DB doesn't need its
-- own copy.

create or replace function public.strength_leaderboard(
  p_gym_id      uuid,
  p_movement_key text,
  p_track_key   text,
  p_metric      text,
  p_better      text
) returns table (
  profile_id    uuid,
  display_name  text,
  value_numeric numeric,
  value_seconds int,
  performed_at  timestamptz,
  source        text,
  rank          integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  select strength_leaderboards_enabled into v_enabled
    from public.gyms where id = p_gym_id;
  if not v_enabled then
    return;
  end if;
  if p_metric not in ('weight','time','reps','distance','calories') then
    raise exception 'Unknown metric %', p_metric;
  end if;
  if p_better not in ('higher','lower') then
    raise exception 'Unknown direction %', p_better;
  end if;

  return query
  with members as (
    select gm.profile_id
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.appear_in_leaderboards
      and gm.left_at is null
  ),
  direct as (
    select r.profile_id, r.value_numeric, r.value_seconds,
           r.performed_at, 'direct'::text as source
    from public.tracked_movement_results r
    join members m on m.profile_id = r.profile_id
    where r.gym_id = p_gym_id
      and r.movement_key = p_movement_key
      and r.track_key = p_track_key
  ),
  tag_sec as (
    select
      t.profile_id,
      t.performed_at,
      s.total_time_seconds,
      s.total_rounds,
      (select max(e.weight_numeric) from public.tracked_section_entries e
        where e.section_id = s.id) as max_weight,
      (case when p_better = 'higher' then
              (select max(e.reps) from public.tracked_section_entries e
                where e.section_id = s.id)
            else
              (select min(e.reps) from public.tracked_section_entries e
                where e.section_id = s.id)
       end) as best_reps,
      (case when p_better = 'higher' then
              (select max(e.distance_numeric) from public.tracked_section_entries e
                where e.section_id = s.id)
            else
              (select min(e.distance_numeric) from public.tracked_section_entries e
                where e.section_id = s.id)
       end) as best_distance,
      (case when p_better = 'higher' then
              (select max(e.calories) from public.tracked_section_entries e
                where e.section_id = s.id)
            else
              (select min(e.calories) from public.tracked_section_entries e
                where e.section_id = s.id)
       end) as best_calories,
      (case when p_better = 'higher' then
              (select max(e.time_seconds) from public.tracked_section_entries e
                where e.section_id = s.id)
            else
              (select min(e.time_seconds) from public.tracked_section_entries e
                where e.section_id = s.id)
       end) as best_time
    from public.tracked_section_movement_tags t
    join public.tracked_workout_sections s on s.id = t.section_id
    join members m on m.profile_id = t.profile_id
    where t.gym_id = p_gym_id
      and t.movement_key = p_movement_key
      and t.track_key = p_track_key
  ),
  tagged as (
    select
      ts.profile_id,
      case p_metric
        when 'weight'   then ts.max_weight
        when 'reps'     then ts.best_reps::numeric
        when 'distance' then ts.best_distance
        when 'calories' then ts.best_calories::numeric
        else null
      end as value_numeric,
      case p_metric
        when 'time' then coalesce(ts.total_time_seconds, ts.best_time)
        else null
      end as value_seconds,
      ts.performed_at,
      'tag'::text as source
    from tag_sec ts
  ),
  unioned as (
    select * from direct
    union all
    select * from tagged
  ),
  per_member as (
    select distinct on (profile_id)
      profile_id, value_numeric, value_seconds, performed_at, source
    from unioned
    where (p_metric = 'time' and value_seconds is not null)
       or (p_metric <> 'time' and value_numeric is not null)
    order by profile_id,
      case
        when p_metric = 'time' then
          (case when p_better = 'higher' then -value_seconds else value_seconds end)::numeric
        else
          (case when p_better = 'higher' then -value_numeric else value_numeric end)
      end asc,
      performed_at asc
  )
  select
    p.profile_id,
    coalesce(pr.full_name, 'Member') as display_name,
    p.value_numeric,
    p.value_seconds,
    p.performed_at,
    p.source,
    rank() over (
      order by
        case
          when p_metric = 'time' then
            (case when p_better = 'higher' then -p.value_seconds else p.value_seconds end)::numeric
          else
            (case when p_better = 'higher' then -p.value_numeric else p.value_numeric end)
        end asc
    )::int as rank
  from per_member p
  left join public.profiles pr on pr.id = p.profile_id
  order by rank asc, p.performed_at asc;
end;
$$;

grant execute on function public.strength_leaderboard(uuid, text, text, text, text) to authenticated;

commit;
