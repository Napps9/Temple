-- import_member_results groups scored-WOD rows by (email, date) into a
-- tracked_workouts parent + a tracked_workout_sections child per result.
-- Emails not matching an active member are skipped. Re-running the same
-- (member, date, format, title) is idempotent (skipped_duplicate).

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@imr.test');
  v_member   uuid := _test_mk_user('izzy@imr.test');
  v_stranger uuid := _test_mk_user('stranger@elsewhere-imr.test');
  v_gym      uuid := _test_mk_gym('Results Gym', 'imr-gym');
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
    'select import_member_results(%L::uuid, %L::jsonb)',
    current_setting('test.gym'),
    '[]'
  ),
  '%Not authorised%',
  'a non-owner is rejected by the RPC'
);
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 2. Happy path: a for_time + an amrap for one member on one date, plus a
--    stranger's row, land as 1 workout, 2 sections, 1 skipped.
select is(
  (with r as (
     select import_member_results(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imr.test', 'date', '2026-05-01',
           'section_category', 'wod', 'section_format', 'for_time',
           'title', 'Fran', 'total_time_seconds', 192),
         jsonb_build_object(
           'email', 'izzy@imr.test', 'date', '2026-05-01',
           'section_category', 'wod', 'section_format', 'amrap',
           'title', 'Cindy', 'total_rounds', 19, 'total_extra_reps', 7),
         jsonb_build_object(
           'email', 'stranger@elsewhere-imr.test', 'date', '2026-05-01',
           'section_category', 'wod', 'section_format', 'for_time',
           'title', 'Fran', 'total_time_seconds', 200)
       )
     ) as t
   )
   select format('%s/%s/%s/%s', (t).inserted_workouts, (t).inserted_sections,
                 (t).skipped_no_member, (t).skipped_duplicate)
   from r),
  '1/2/1/0',
  'two sections for one member on one date land as 1 workout + 2 sections, stranger skipped'
);

-- 3. The parent workout exists.
select is(
  (select count(*)::int from public.tracked_workouts
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  1,
  'one tracked_workouts row was created'
);

-- 4. The two sections are linked to that parent.
select is(
  (select count(*)::int from public.tracked_workout_sections
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid),
  2,
  'two tracked_workout_sections rows were created'
);

-- 5. Re-importing the same (member, date, format, title) is idempotent.
select is(
  (with r as (
     select import_member_results(
       current_setting('test.gym')::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'email', 'izzy@imr.test', 'date', '2026-05-01',
           'section_category', 'wod', 'section_format', 'for_time',
           'title', 'Fran', 'total_time_seconds', 999)
       )
     ) as t
   )
   select format('%s/%s/%s', (t).inserted_workouts, (t).inserted_sections,
                 (t).skipped_duplicate)
   from r),
  '0/0/1',
  're-importing the same benchmark reuses the parent and skips the duplicate'
);

-- 6. The for_time section stored the parsed seconds.
select is(
  (select total_time_seconds from public.tracked_workout_sections
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid
     and section_format = 'for_time'),
  192,
  'for_time section carries total_time_seconds'
);

-- 7. The amrap section stored rounds + extra reps.
select is(
  (select format('%s+%s', total_rounds, total_extra_reps)
   from public.tracked_workout_sections
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.member')::uuid
     and section_format = 'amrap'),
  '19+7',
  'amrap section carries total_rounds and total_extra_reps'
);

select * from finish();
rollback;
