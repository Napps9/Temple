-- import_member_workouts groups CSV rows by (email, date) into a
-- tracked_workouts parent + a tracked_movement_results child per row.
-- Emails that don't match an active member of the gym are skipped.
-- Re-running the import for the same (member, date) reuses the parent.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@imw.test');
  v_member   uuid := _test_mk_user('izzy@imw.test');
  v_stranger uuid := _test_mk_user('stranger@elsewhere.test');
  v_gym      uuid := _test_mk_gym('Import Gym', 'imw-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  -- v_stranger has no membership in this gym.
  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.member',  v_member::text,  true);
  perform _test_act_as(v_owner);
end $$;

-- 1. Non-owner can't call the RPC. Switch to the member temporarily.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_like(
  format(
    'select import_member_workouts(%L::uuid, %L::jsonb)',
    current_setting('test.gym'),
    '[]'
  ),
  '%Not authorised%',
  'a non-owner is rejected by the RPC'
);
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 2. Happy path: two rows for one member on one date + one for a
--    stranger's email get aggregated as 1 workout, 2 results, 1 skipped.
select is(
  (with r as (
     select import_member_workouts(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imw.test', 'date', '2026-05-01',
           'movement_key', 'back_squat', 'reps', 5, 'weight', 100, 'unit', 'kg'),
         jsonb_build_object(
           'email', 'izzy@imw.test', 'date', '2026-05-01',
           'movement_key', 'deadlift',  'reps', 3, 'weight', 150, 'unit', 'kg'),
         jsonb_build_object(
           'email', 'stranger@elsewhere.test', 'date', '2026-05-01',
           'movement_key', 'back_squat', 'reps', 5, 'weight', 100, 'unit', 'kg')
       )
     ) as t
   )
   select format('%s/%s/%s', (t).inserted_workouts,
                 (t).inserted_results, (t).skipped_no_member)
   from r),
  '1/2/1',
  'two rows for one member on one date land as 1 workout + 2 results, stranger skipped'
);

-- 3. The parent workout actually exists.
select is(
  (select count(*)::int from public.tracked_workouts
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  1,
  'one tracked_workouts row was created'
);

-- 4. The two results are linked to that parent.
select is(
  (select count(*)::int from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  2,
  'two tracked_movement_results rows were created'
);

-- 5. Re-importing the same (member, date) reuses the parent.
select is(
  (with r as (
     select import_member_workouts(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imw.test', 'date', '2026-05-01',
           'movement_key', 'bench_press', 'reps', 5, 'weight', 80, 'unit', 'kg')
       )
     ) as t
   )
   select (t).inserted_workouts from r),
  0,
  're-importing the same date reuses the existing tracked_workouts parent (0 new)'
);

-- 6. Same date now has three results total.
select is(
  (select count(*)::int from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  3,
  'the second-pass result was added to the existing workout (3 total)'
);

-- 7. Setup checklist 'workouts_imported' flips done.
select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'workouts_imported'),
  true,
  'workouts_imported setup step flips done once a tracked_workouts row exists'
);

select * from finish();
rollback;
