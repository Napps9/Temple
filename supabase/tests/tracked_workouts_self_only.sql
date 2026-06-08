-- RLS isolation: a member cannot SELECT another member's
-- tracked_workouts row, but a coach can (default capability is on).
-- Backfills the coverage 0023 shipped without.
--
-- The do-block setup runs as the migration role (RLS off), so we can
-- seed rows for each member directly. _test_act_as is only called
-- once per assertion to switch into 'authenticated' as the subject
-- whose visibility we're checking.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@tw.test');
  v_coach  uuid := _test_mk_user('coach@tw.test');
  v_a      uuid := _test_mk_user('a@tw.test');
  v_b      uuid := _test_mk_user('b@tw.test');
  v_gym    uuid := _test_mk_gym('Workout Gym', 'workout-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  insert into public.tracked_workouts (gym_id, profile_id, title)
    values (v_gym, v_a, 'A workout');
  insert into public.tracked_workouts (gym_id, profile_id, title)
    values (v_gym, v_b, 'B workout');

  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- Member A acting: sees their own row, not B's.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workouts
    where profile_id = current_setting('test.b')::uuid)::int,
  0,
  'member A cannot SELECT member B''s tracked_workouts'
);

-- Coach acting: capability default ON → sees both members' rows.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workouts)::int,
  2,
  'coach can SELECT both members'' tracked_workouts by default'
);

select * from finish();
rollback;
