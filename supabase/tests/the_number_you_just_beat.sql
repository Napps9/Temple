-- record_personal_best (0263). The rule that matters is the one the
-- badge gets right and a message would get wrong: a first-ever log is
-- not a personal best. Beyond that — strictly better, prior best read
-- from what is stored rather than what the caller claims, one row per
-- movement per day, and the milestone is the member's own.

begin;
select plan(13);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@pb.test');
  v_member uuid := _test_mk_user('member@pb.test');
  v_other  uuid := _test_mk_user('other@pb.test');
  v_gym    uuid := _test_mk_gym('PB Gym', 'pb-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other, 'member');
  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.other',  v_other::text,  false);
end $$;

select _test_act_as(current_setting('test.member')::uuid);

-- 1. A first-ever log is not a personal best.
select is(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', '1rm',
     'weight', 'higher', 100, null, 'kg', now() - interval '30 days')),
  null,
  'the first log of a movement is not a personal best'
);
select is(
  (select count(*)::int from public.member_milestones),
  0,
  'and writes no milestone'
);

-- Record that first lift for real, so there is something to beat.
insert into public.tracked_workouts (gym_id, profile_id, performed_at)
values (current_setting('test.gym')::uuid,
        current_setting('test.member')::uuid, now() - interval '30 days');
insert into public.tracked_movement_results
  (gym_id, profile_id, workout_id, movement_key, track_key,
   value_numeric, value_unit, performed_at)
select current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid, w.id,
       'back_squat', '1rm', 100, 'kg', now() - interval '30 days'
  from public.tracked_workouts w
 where w.profile_id = current_setting('test.member')::uuid
 limit 1;

-- 2. Beating it is a personal best.
select isnt(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', '1rm',
     'weight', 'higher', 102.5, null, 'kg', now())),
  null,
  'beating the stored best writes a milestone'
);
select is(
  (select body from public.member_milestones limit 1),
  '102.5 kg — up from 100 kg.',
  'the message names the new number and the one it beat'
);

-- 3. Matching it is not beating it.
select is(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', '1rm',
     'weight', 'higher', 100, null, 'kg', now())),
  null,
  'equalling the old best is not a personal best'
);

-- 4. Same movement, same day, twice: one row.
select isnt(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', '1rm',
     'weight', 'higher', 105, null, 'kg', now())),
  null,
  'a better lift the same day still counts'
);
select is(
  (select count(*)::int from public.member_milestones),
  1,
  'but it updates the day''s row rather than adding a second'
);
select is(
  (select body from public.member_milestones limit 1),
  '105 kg — up from 100 kg.',
  'and the row carries the latest number'
);

-- 5. Lower-is-better works the other way round.
insert into public.tracked_movement_results
  (gym_id, profile_id, workout_id, movement_key, track_key,
   value_seconds, performed_at)
select current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid, w.id,
       'row', '2000m', 420, now() - interval '10 days'
  from public.tracked_workouts w
 where w.profile_id = current_setting('test.member')::uuid
 limit 1;
select isnt(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'row', '2000m',
     'time', 'lower', null, 400, null, now())),
  null,
  'a faster time is a personal best'
);
select is(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'row', '2000m',
     'time', 'lower', null, 430, null, now())),
  null,
  'a slower time is not'
);

-- 6. An unknown direction is refused, in the words 0101 uses.
select throws_ok(
  $$select public.record_personal_best(
      current_setting('test.gym')::uuid, 'back_squat', '1rm',
      'weight', 'sideways', 200, null, 'kg', now())$$,
  'Unknown direction sideways',
  'an unknown direction is refused'
);

-- 7. A milestone is the member's own.
select _test_act_as(current_setting('test.other')::uuid);
select is(
  (select count(*)::int from public.member_milestones),
  0,
  'another member cannot read these milestones'
);

-- 8. anon holds no execute grant.
select ok(
  not has_function_privilege(
    'anon',
    'public.record_personal_best(uuid,text,text,text,text,numeric,integer,text,timestamptz,date)',
    'execute'),
  'anon cannot record a personal best'
);

select * from finish();
rollback;
