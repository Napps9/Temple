-- Scored-result import RPC (Phase A of the results importer).
--
-- Companion to import_member_workouts (0072). That RPC ingests weighted
-- movements; this one ingests benchmark WODs whose score is a time
-- (FOR_TIME) or an AMRAP round count (FOR_ROUNDS_REPS), writing a
-- tracked_workout_sections row per result rather than a movement result.
-- Sections are title-based, so the workout name (Fran, Cindy, Grace…)
-- becomes the section title — no movement vocabulary needed. See
-- docs/workout-results-import-scope.md.
--
-- Each input row:
--   { email, date (YYYY-MM-DD), section_category, section_format,
--     title, total_time_seconds?, total_rounds?, total_extra_reps?,
--     notes? }
--
-- Grouping mirrors 0072: rows sharing (email, date) collapse into the
-- same tracked_workouts parent — the SAME parent the movement importer
-- reuses, so a member's day shows one workout whether it carried lifts,
-- benchmarks, or both. Re-runs are idempotent: a section already present
-- for (workout, format, title) is skipped rather than duplicated.
--
-- Authorisation: owner-only, matching import_member_workouts.

begin;

create or replace function public.import_member_results(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts  integer,
  inserted_sections  integer,
  skipped_no_member  integer,
  skipped_duplicate  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row               jsonb;
  v_email             text;
  v_date              date;
  v_category          text;
  v_format            text;
  v_title             text;
  v_time_seconds      int;
  v_rounds            int;
  v_extra_reps        int;
  v_notes             text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_sort_order        int;
  v_inserted_workouts int := 0;
  v_inserted_sections int := 0;
  v_skipped_no_member int := 0;
  v_skipped_duplicate int := 0;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised to import results for this gym';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email    := lower(nullif(trim(v_row->>'email'), ''));
    v_category := coalesce(nullif(trim(v_row->>'section_category'), ''), 'wod');
    v_format   := nullif(trim(v_row->>'section_format'), '');
    v_title    := nullif(trim(v_row->>'title'), '');
    v_notes    := nullif(v_row->>'notes', '');

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    if v_email is null or v_date is null or v_format is null then
      continue;
    end if;

    v_time_seconds := nullif(v_row->>'total_time_seconds', '')::int;
    v_rounds       := nullif(v_row->>'total_rounds', '')::int;
    v_extra_reps   := nullif(v_row->>'total_extra_reps', '')::int;

    -- Match email to an active member of this gym (profiles has no email;
    -- it lives on auth.users, readable under SECURITY DEFINER).
    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;
    if v_profile_id is null then
      v_skipped_no_member := v_skipped_no_member + 1;
      continue;
    end if;

    -- One tracked_workouts parent per (profile, date), shared with the
    -- movement importer.
    select id into v_workout_id
      from public.tracked_workouts
      where gym_id = p_gym_id
        and profile_id = v_profile_id
        and performed_at::date = v_date
      order by performed_at
      limit 1;
    if v_workout_id is null then
      insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
        values (p_gym_id, v_profile_id, v_date::timestamptz, 'Imported')
        returning id into v_workout_id;
      v_inserted_workouts := v_inserted_workouts + 1;
    end if;

    -- Idempotent: same benchmark on the same day isn't inserted twice.
    if exists (
      select 1 from public.tracked_workout_sections
      where workout_id = v_workout_id
        and section_format = v_format
        and coalesce(title, '') = coalesce(v_title, '')
    ) then
      v_skipped_duplicate := v_skipped_duplicate + 1;
      continue;
    end if;

    select coalesce(max(sort_order), -1) + 1 into v_sort_order
      from public.tracked_workout_sections
      where workout_id = v_workout_id;

    insert into public.tracked_workout_sections
      (gym_id, profile_id, workout_id, section_category, section_format,
       title, notes, sort_order, total_time_seconds, total_rounds,
       total_extra_reps)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_category, v_format,
       v_title, v_notes, v_sort_order, v_time_seconds, v_rounds,
       v_extra_reps);
    v_inserted_sections := v_inserted_sections + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_sections,
           v_skipped_no_member, v_skipped_duplicate;
end;
$$;

grant execute on function public.import_member_results(uuid, jsonb)
  to authenticated;

commit;
