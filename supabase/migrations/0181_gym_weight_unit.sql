-- Store weights in kilograms, display them in whatever the gym uses.
--
-- Weights have been stored unit-tagged since 0023 and normalised never.
-- Every in-app writer hardcodes 'kg'; exactly one path writes anything
-- else — the CSV importer (0134:283, :303) and its deferred replay for
-- pending members (0134:100). And nothing that COMPARES weights looks at
-- the unit: bestOf (track.ts), prRowIds and deriveTagValue
-- (movement-journal.ts), strength_leaderboard (0101:334), class_leaderboard
-- (0101:139) and computeMovementTrends all compare raw numerics.
--
-- So a member who imports a 315 lb deadlift outranks a member who lifted
-- 200 kg, and permanently suppresses their own later real PRs, because
-- 315 > 200 and nothing knows the difference.
--
-- Fix in two halves:
--   1. kg becomes canonical in storage. Convert at the import boundary and
--      backfill what is already there — including rows still sitting in
--      pending_member_workouts.payload waiting for a signup that may be
--      months away.
--   2. gyms.weight_unit says how to DISPLAY it, converting at the edges.
--
-- Note value_unit is shared across metrics — it carries 'm' and 'cal' for
-- distance and calorie rows too (0023:48). Every statement below names the
-- weight units explicitly rather than treating "not kg" as poundage.

begin;

-- ============================================================================
-- 1. Backfill: what is already stored in pounds becomes kilograms
-- ============================================================================

update public.tracked_movement_results
  set value_numeric = round(value_numeric * 0.45359237, 2),
      value_unit    = 'kg'
  where value_numeric is not null
    and lower(coalesce(value_unit, '')) in ('lb', 'lbs', 'pound', 'pounds');

update public.tracked_section_entries
  set weight_numeric = round(weight_numeric * 0.45359237, 2),
      weight_unit    = 'kg'
  where weight_numeric is not null
    and lower(coalesce(weight_unit, '')) in ('lb', 'lbs', 'pound', 'pounds');

-- Staged imports for members who have not signed up yet. Without this the
-- conversion would be undone the moment they do — apply_pending_member_data
-- reads value_unit straight back out of the payload (0134:100).
update public.pending_member_workouts
  set payload = jsonb_set(
        jsonb_set(payload, '{value_numeric}',
          to_jsonb(round((payload->>'value_numeric')::numeric * 0.45359237, 2))),
        '{value_unit}', '"kg"'::jsonb)
  where payload->>'value_numeric' is not null
    and lower(coalesce(payload->>'value_unit', '')) in
        ('lb', 'lbs', 'pound', 'pounds');

-- ============================================================================
-- 2. Convert at the import boundary
-- ============================================================================
--
-- Body is 0134's verbatim apart from the conversion. The importer keeps
-- ACCEPTING lb — a gym exporting from a US system should not have to
-- convert a spreadsheet by hand — it just stops storing it.

create or replace function public._to_kg(p_value numeric, p_unit text)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then null
    when lower(coalesce(p_unit, '')) in ('lb', 'lbs', 'pound', 'pounds')
      then round(p_value * 0.45359237, 2)
    else p_value
  end;
$$;

create or replace function public.import_member_workouts(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts    integer,
  inserted_results     integer,
  skipped_no_member    integer,
  skipped_no_movement  integer,
  staged               integer
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
  v_reps              integer;
  v_weight            numeric;
  v_unit              text;
  v_notes             text;
  v_track_key         text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_inserted_workouts   integer := 0;
  v_inserted_results    integer := 0;
  v_skipped_no_member   integer := 0;
  v_skipped_no_movement integer := 0;
  v_staged              integer := 0;
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

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    if v_email is null or v_date is null then
      continue;
    end if;
    if v_movement_key is null then
      v_skipped_no_movement := v_skipped_no_movement + 1;
      continue;
    end if;

    v_reps := nullif(v_row->>'reps', '')::int;
    if v_reps is null or v_reps < 1 then v_reps := 1; end if;
    if v_reps > 30 then v_reps := 30; end if;
    -- Kilograms are canonical in storage (0181). The importer still
    -- ACCEPTS lb — a gym exporting from a US system should not have to
    -- convert a spreadsheet by hand — it just stops storing it, because
    -- nothing that compares weights looks at the unit.
    v_weight := public._to_kg(nullif(v_row->>'weight', '')::numeric, v_unit);
    v_unit   := case
      when lower(v_unit) in ('lb', 'lbs', 'pound', 'pounds') then 'kg'
      else v_unit
    end;
    v_track_key := v_reps || 'rm';

    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;

    if v_profile_id is null then
      -- Stage against a pending member; otherwise it's a genuinely unknown
      -- email and we skip it.
      if exists (select 1 from public.pending_members
                 where gym_id = p_gym_id and lower(email) = v_email) then
        insert into public.pending_member_workouts
          (gym_id, email, performed_on, kind, dedup_key, payload)
        values (p_gym_id, v_email, v_date, 'movement',
          v_movement_key || '|' || v_track_key,
          jsonb_build_object(
            'movement_key', v_movement_key, 'track_key', v_track_key,
            'value_numeric', v_weight, 'value_unit', v_unit, 'notes', v_notes))
        on conflict (gym_id, email, performed_on, kind, dedup_key) do nothing;
        v_staged := v_staged + 1;
      else
        v_skipped_no_member := v_skipped_no_member + 1;
      end if;
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
           v_skipped_no_member, v_skipped_no_movement, v_staged;
end;
$$;

-- ============================================================================
-- 3. gyms.weight_unit — display only
-- ============================================================================
--
-- Mirrors set_gym_discipline (0088): a CHECK rather than a lookup table,
-- because the set of units is a code-level concept, and an owner-gated
-- definer setter so the client never writes gyms directly.

alter table public.gyms
  add column weight_unit text not null default 'kg'
    check (weight_unit in ('kg', 'lb'));

create or replace function public.set_gym_weight_unit(
  p_gym_id uuid,
  p_unit   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the weight unit';
  end if;
  if p_unit not in ('kg', 'lb') then
    raise exception 'Unknown weight unit: %', p_unit;
  end if;
  update public.gyms set weight_unit = p_unit where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_weight_unit(uuid, text) to authenticated;

-- Nothing else needs the unit plumbed through. With kg canonical in
-- storage, strength_leaderboard's raw-numeric comparison is finally
-- comparing like with like, and formatStrengthValue's hardcoded 'kg' goes
-- from a lie to merely redundant — the client converts for display from
-- gyms.weight_unit instead.

commit;
