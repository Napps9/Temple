-- Workout-history import RPC for the onboarding wizard.
--
-- Pairs with the members importer (0046) so a new gym can seed both
-- people and their training history before the first member signs in.
-- Each input row is one logged set:
--   { email, date (YYYY-MM-DD), movement_key, reps, weight, unit, notes }
--
-- The movement_key is resolved client-side from the vocab in
-- src/lib/movements.ts so the preview can surface unresolved names
-- before commit — by the time rows reach this RPC every movement_key
-- is expected to be a known vocab entry.
--
-- Grouping: rows that share (email, date) collapse into one
-- tracked_workouts parent so the member's /track view shows a single
-- workout per day with multiple movement results, matching how the
-- in-app logger writes data.
--
-- Authorisation: owner-only — the gyms.id check is done up front;
-- profile resolution uses the gym's active gym_memberships, so emails
-- belonging to other gyms (or no gym) come back as skipped_no_member.

begin;

create or replace function public.import_member_workouts(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts     integer,
  inserted_results      integer,
  skipped_no_member     integer,
  skipped_no_movement   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row              jsonb;
  v_email            text;
  v_date             date;
  v_movement_key     text;
  v_reps             integer;
  v_weight           numeric;
  v_unit             text;
  v_notes            text;
  v_profile_id       uuid;
  v_workout_id       uuid;
  v_track_key        text;
  v_inserted_workouts   integer := 0;
  v_inserted_results    integer := 0;
  v_skipped_no_member   integer := 0;
  v_skipped_no_movement integer := 0;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised to import workouts for this gym';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email        := lower(nullif(trim(v_row->>'email'),     ''));
    v_movement_key :=         nullif(trim(v_row->>'movement_key'), '');
    v_unit         :=         coalesce(nullif(v_row->>'unit', ''), 'kg');
    v_notes        :=         nullif(v_row->>'notes', '');

    -- date: defensive cast, skip malformed rows.
    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      v_skipped_no_member := v_skipped_no_member;  -- no-op; just continue
      continue;
    end;

    if v_email is null or v_date is null then
      continue;
    end if;
    if v_movement_key is null then
      v_skipped_no_movement := v_skipped_no_movement + 1;
      continue;
    end if;

    -- numeric coercions; reps clamps into the Nrm scheme range, weight
    -- left null for bodyweight movements.
    v_reps := nullif(v_row->>'reps', '')::int;
    if v_reps is null or v_reps < 1 then v_reps := 1; end if;
    if v_reps > 30 then v_reps := 30; end if;
    v_weight := nullif(v_row->>'weight', '')::numeric;

    -- Match email to an active member of this gym. profiles has no
    -- email column — it lives on auth.users, which the SECURITY
    -- DEFINER context can read.
    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;
    -- Pending members (staged but not yet linked to an auth user) can't
    -- receive history yet — tracked_workouts.profile_id requires a
    -- real profile. Skip them with a count so the owner sees how many
    -- rows are waiting on signups.
    if v_profile_id is null then
      v_skipped_no_member := v_skipped_no_member + 1;
      continue;
    end if;

    -- One tracked_workouts parent per (profile, date). Re-runs of the
    -- importer reuse the same parent so results aren't double-counted.
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

    v_track_key := v_reps || 'rm';

    insert into public.tracked_movement_results
      (gym_id, profile_id, workout_id, movement_key, track_key,
       value_numeric, value_unit, notes)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_movement_key, v_track_key,
       v_weight, v_unit, v_notes);
    v_inserted_results := v_inserted_results + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_results,
           v_skipped_no_member, v_skipped_no_movement;
end;
$$;

grant execute on function public.import_member_workouts(uuid, jsonb)
  to authenticated;

-- ============================================================================
-- Setup checklist: 'members_imported' + 'workouts_imported'
-- ============================================================================
--
-- Both optional from the client's point of view, but the RPC still
-- reports their state so the checklist's progress reflects them.

create or replace function public.get_gym_setup_progress(p_gym_id uuid)
returns table (step_key text, done boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
    select 'logo'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and coalesce(logo_url, '') <> ''
      )
    union all
    select 'settings'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and operating_defaults_reviewed_at is not null
      )
    union all
    select 'class_type'::text,
      exists (
        select 1 from public.class_types
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'schedule'::text,
      exists (
        select 1
        from public.class_recurrences cr
        join public.class_types ct on ct.id = cr.class_type_id
        where cr.gym_id = p_gym_id and ct.archived_at is null
      )
    union all
    select 'parq'::text,
      exists (
        select 1 from public.parq_questionnaires
        where gym_id = p_gym_id and is_active
      )
      or exists (
        select 1 from public.waiver_documents
        where gym_id = p_gym_id and is_active
      )
    union all
    select 'plan'::text,
      exists (
        select 1 from public.membership_plans
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'team'::text,
      exists (
        select 1 from public.invite_codes
        where gym_id = p_gym_id
      )
      or exists (
        select 1 from public.gym_memberships
        where gym_id = p_gym_id
          and role in ('admin', 'coach', 'staff')
          and left_at is null
      )
    union all
    select 'members_imported'::text,
      exists (
        select 1 from public.pending_members
        where gym_id = p_gym_id
      )
    union all
    select 'workouts_imported'::text,
      exists (
        select 1 from public.tracked_workouts
        where gym_id = p_gym_id
      );
end;
$$;

commit;
