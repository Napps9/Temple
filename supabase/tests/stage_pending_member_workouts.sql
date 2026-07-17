-- A workout row whose email matches a pending (imported, not-yet-signed-up)
-- member is staged in pending_member_workouts instead of skipped, and
-- flushed into the member's real log by the apply_pending_member_data
-- trigger when they sign up. A row matching no member and no pending
-- member is still skipped.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@stage.test');
  v_gym   uuid := _test_mk_gym('Stage Gym', 'stage-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  -- A pending member: imported, no signup yet (no auth user / membership).
  insert into public.pending_members (gym_id, email)
    values (v_gym, 'ghost@stage.test');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  -- Authorise the owner-gated import RPC via the JWT claim only — NOT
  -- _test_act_as, which switches to the 'authenticated' role and would
  -- block the _test_mk_user (auth.users insert) at signup below. The
  -- import RPC is SECURITY DEFINER and only checks auth.uid().
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner)::text, true);
end $$;

-- 1. Importing a lift for the pending member stages it (not inserted, not
--    skipped); a lift for a genuinely unknown email is skipped.
select is(
  (with r as (
     select import_member_workouts(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'ghost@stage.test', 'date', '2026-05-01',
           'movement_key', 'back_squat', 'reps', 1, 'weight', 100, 'unit', 'kg'),
         jsonb_build_object(
           'email', 'nobody@nowhere.test', 'date', '2026-05-01',
           'movement_key', 'back_squat', 'reps', 1, 'weight', 100, 'unit', 'kg')
       )
     ) as t
   )
   select format('%s/%s/%s', (t).inserted_results, (t).skipped_no_member, (t).staged)
   from r),
  '0/1/1',
  'pending member row is staged; unknown email is skipped'
);

-- 2. The staged row is in the queue.
select is(
  (select count(*)::int from public.pending_member_workouts
   where gym_id = current_setting('test.gym')::uuid
     and email = 'ghost@stage.test'),
  1,
  'one row is queued in pending_member_workouts'
);

-- 3. No real results exist yet (the member hasn't signed up).
select is(
  (select count(*)::int from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid),
  0,
  'nothing is in the real log before signup'
);

-- 4. The member signs up: creating their membership fires the flush trigger.
do $$
declare
  v_ghost uuid := _test_mk_user('ghost@stage.test');
begin
  perform _test_mk_membership(current_setting('test.gym')::uuid, v_ghost, 'member');
  perform set_config('test.ghost', v_ghost::text, true);
end $$;

select is(
  (select count(*)::int from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.ghost')::uuid),
  1,
  'the staged result materialised in the member log on signup'
);

-- 5. It carries the staged values.
select is(
  (select format('%s/%s/%s', movement_key, track_key, value_numeric)
   from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.ghost')::uuid),
  'back_squat/1rm/100',
  'the flushed result kept its movement, scheme and weight'
);

-- 6. The staging queue is cleared after the flush.
select is(
  (select count(*)::int from public.pending_member_workouts
   where gym_id = current_setting('test.gym')::uuid
     and email = 'ghost@stage.test'),
  0,
  'the staging queue is emptied once flushed'
);

select * from finish();
rollback;
