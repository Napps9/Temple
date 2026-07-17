-- Hyrox / time-based result import RPC (Phase B of the results importer).
--
-- Third companion to import_member_workouts (0072, weighted lifts) and
-- import_member_results (0132, scored WOD sections). This one writes
-- time-scored movement results — Hyrox station splits and official race
-- times — into tracked_movement_results using value_seconds (the same
-- rows the in-app Hyrox tracker writes, and what PR badges / sparklines /
-- leaderboards read). See docs/workout-results-import-scope.md.
--
-- Each input row:
--   { email, date (YYYY-MM-DD), movement_key, track_key,
--     value_seconds, notes? }
--
-- movement_key is a Hyrox station key (hyrox_ski_erg…) or 'hyrox_time';
-- track_key is the station's PB scheme ('1000m', '50m'…) or 'full'.
-- Grouping + dedup mirror the sibling RPCs: one tracked_workouts parent
-- per (email, date), and a result already present for
-- (workout, movement_key, track_key) is skipped rather than duplicated.
--
-- Authorisation: owner-only.

begin;

create or replace function public.import_member_hyrox_results(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts  integer,
  inserted_results   integer,
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
  v_movement_key      text;
  v_track_key         text;
  v_value_seconds     int;
  v_notes             text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_inserted_workouts int := 0;
  v_inserted_results  int := 0;
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
    v_email        := lower(nullif(trim(v_row->>'email'), ''));
    v_movement_key := nullif(trim(v_row->>'movement_key'), '');
    v_track_key    := nullif(trim(v_row->>'track_key'), '');
    v_notes        := nullif(v_row->>'notes', '');

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    v_value_seconds := nullif(v_row->>'value_seconds', '')::int;

    if v_email is null or v_date is null or v_movement_key is null
       or v_track_key is null or v_value_seconds is null then
      continue;
    end if;

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

    if exists (
      select 1 from public.tracked_movement_results
      where workout_id = v_workout_id
        and movement_key = v_movement_key
        and track_key = v_track_key
    ) then
      v_skipped_duplicate := v_skipped_duplicate + 1;
      continue;
    end if;

    insert into public.tracked_movement_results
      (gym_id, profile_id, workout_id, movement_key, track_key,
       value_seconds, notes)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_movement_key, v_track_key,
       v_value_seconds, v_notes);
    v_inserted_results := v_inserted_results + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_results,
           v_skipped_no_member, v_skipped_duplicate;
end;
$$;

grant execute on function public.import_member_hyrox_results(uuid, jsonb)
  to authenticated;

commit;
