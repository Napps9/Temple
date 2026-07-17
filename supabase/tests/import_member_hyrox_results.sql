-- import_member_hyrox_results groups time-scored rows by (email, date)
-- into a tracked_workouts parent + a tracked_movement_results child per
-- station/total (value_seconds). Non-members are skipped; re-running the
-- same (movement_key, track_key) is idempotent.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@imh.test');
  v_member   uuid := _test_mk_user('izzy@imh.test');
  v_stranger uuid := _test_mk_user('stranger@elsewhere-imh.test');
  v_gym      uuid := _test_mk_gym('Hyrox Gym', 'imh-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform _test_act_as(v_owner);
end $$;

-- 1. Non-owner can't call the RPC.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_like(
  format(
    'select import_member_hyrox_results(%L::uuid, %L::jsonb)',
    current_setting('test.gym'),
    '[]'
  ),
  '%Not authorised%',
  'a non-owner is rejected by the RPC'
);
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 2. Happy path: two station splits + a total for one member on one date,
--    plus a stranger's row, land as 1 workout, 3 results, 1 skipped.
select is(
  (with r as (
     select import_member_hyrox_results(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imh.test', 'date', '2026-07-12',
           'movement_key', 'hyrox_ski_erg', 'track_key', '1000m',
           'value_seconds', 238),
         jsonb_build_object(
           'email', 'izzy@imh.test', 'date', '2026-07-12',
           'movement_key', 'hyrox_sled_push', 'track_key', '50m',
           'value_seconds', 130),
         jsonb_build_object(
           'email', 'izzy@imh.test', 'date', '2026-07-12',
           'movement_key', 'hyrox_time', 'track_key', 'full',
           'value_seconds', 3910),
         jsonb_build_object(
           'email', 'stranger@elsewhere-imh.test', 'date', '2026-07-12',
           'movement_key', 'hyrox_ski_erg', 'track_key', '1000m',
           'value_seconds', 300)
       )
     ) as t
   )
   select format('%s/%s/%s/%s', (t).inserted_workouts, (t).inserted_results,
                 (t).skipped_no_member, (t).skipped_duplicate)
   from r),
  '1/3/1/0',
  'three results for one member on one date land as 1 workout + 3 results, stranger skipped'
);

-- 3. The parent workout exists.
select is(
  (select count(*)::int from public.tracked_workouts
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  1,
  'one tracked_workouts row was created'
);

-- 4. The three results are linked to that parent.
select is(
  (select count(*)::int from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  3,
  'three tracked_movement_results rows were created'
);

-- 5. Re-importing the same (movement_key, track_key) is idempotent.
select is(
  (with r as (
     select import_member_hyrox_results(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imh.test', 'date', '2026-07-12',
           'movement_key', 'hyrox_ski_erg', 'track_key', '1000m',
           'value_seconds', 999)
       )
     ) as t
   )
   select format('%s/%s/%s', (t).inserted_workouts, (t).inserted_results,
                 (t).skipped_duplicate)
   from r),
  '0/0/1',
  're-importing the same station split reuses the parent and skips the duplicate'
);

-- 6. The station result stored value_seconds.
select is(
  (select value_seconds from public.tracked_movement_results
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid
     and movement_key = 'hyrox_ski_erg'),
  238,
  'the ski-erg split carries value_seconds'
);

select * from finish();
rollback;
