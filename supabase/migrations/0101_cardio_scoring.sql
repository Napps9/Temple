-- Cardio scoring formats: max_distance + max_calories.
--
-- Coaches programming erg/bike/run conditioning ("12 min max cals on
-- the assault bike", "20 min max distance row") had no scoring format
-- that captured the result — for_time assumes a fixed task, amrap
-- assumes rounds. Two new aggregate-first formats fix that:
--
--   max_distance — score is metres covered (higher wins). Optional
--                  total time so the client can derive /500m or /km
--                  pace for rowing, ski erg, and running.
--   max_calories — score is calories (higher wins), same optional time.
--
-- Storage: two nullable aggregate columns on tracked_workout_sections,
-- following the aggregate invariant from 0025 (format decides which
-- columns are populated). total_distance_m is always metres — the
-- entry table's distance_unit flexibility isn't needed here because
-- the leaderboard has to compare members directly.
--
-- class_leaderboard gains scoring cases for both formats, with a
-- fallback to summed split entries when the member logged rows but no
-- headline aggregate. The RETURNS shape changes (two new columns), so
-- the function is dropped first — CREATE OR REPLACE can't change a
-- RETURNS TABLE shape (see 0043).

begin;

-- ============================================================================
-- 1. Aggregate columns
-- ============================================================================

alter table public.tracked_workout_sections
  add column if not exists total_distance_m numeric,
  add column if not exists total_calories   integer;

-- ============================================================================
-- 2. class_leaderboard — add max_distance / max_calories scoring
-- ============================================================================

drop function if exists public.class_leaderboard(uuid, integer);

create function public.class_leaderboard(
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
  total_distance_m numeric,
  total_calories int,
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
           s.total_distance_m, s.total_calories,
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
  -- count of filled rows, summed cardio splits).
  ent as (
    select e.section_id,
           max(e.weight_numeric) as heaviest_weight,
           max(e.weight_unit) as weight_unit,
           sum(e.distance_numeric) as sum_distance,
           sum(e.calories)::int as sum_calories,
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
      coalesce(s.total_distance_m, e.sum_distance) as total_distance_m,
      coalesce(s.total_calories, e.sum_calories) as total_calories,
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
        when 'max_distance' then
          coalesce(s.total_distance_m, e.sum_distance, 0)
        when 'max_calories' then
          coalesce(s.total_calories, e.sum_calories, 0)::numeric
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
  -- they logged it more than once). Source columns are aliased
  -- because RETURNS TABLE turns the output column names into
  -- PL/pgSQL variables, which would otherwise shadow bare references.
  per_member as (
    select distinct on (sc.profile_id)
      sc.profile_id, sc.section_format,
      sc.total_time_seconds, sc.total_rounds, sc.total_extra_reps,
      sc.did_not_finish, sc.heaviest_weight, sc.weight_unit,
      sc.total_distance_m, sc.total_calories,
      sc.performed_at, sc.score
    from scored sc
    order by sc.profile_id, sc.score desc, sc.performed_at desc
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
    p.total_distance_m,
    p.total_calories,
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
-- 3. strength_leaderboard — honour the cardio section aggregates
-- ============================================================================
--
-- Tag-derived distance / calories values previously only looked at the
-- per-entry columns. A max_distance / max_calories section usually
-- carries the headline aggregate and no entries, so fall back to it —
-- mirroring deriveTagValue in src/lib/movement-journal.ts. RETURNS
-- shape is unchanged, so CREATE OR REPLACE is safe here.

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
      s.total_distance_m,
      s.total_calories,
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
        when 'distance' then coalesce(ts.best_distance, ts.total_distance_m)
        when 'calories' then coalesce(ts.best_calories::numeric, ts.total_calories::numeric)
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
    -- Source columns aliased through `u.` because the RETURNS TABLE
    -- output column names (profile_id, value_numeric, ...) become
    -- PL/pgSQL variables that shadow bare column references.
    select distinct on (u.profile_id)
      u.profile_id, u.value_numeric, u.value_seconds, u.performed_at, u.source
    from unioned u
    where (p_metric = 'time' and u.value_seconds is not null)
       or (p_metric <> 'time' and u.value_numeric is not null)
    order by u.profile_id,
      case
        when p_metric = 'time' then
          (case when p_better = 'higher' then -u.value_seconds else u.value_seconds end)::numeric
        else
          (case when p_better = 'higher' then -u.value_numeric else u.value_numeric end)
      end asc,
      u.performed_at asc
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
