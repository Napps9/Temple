-- The capability gate works: by default a coach can read a member's
-- tracked_workouts (default_capability grants 'can_see_workout_logs'
-- to coach), and flipping the override to FALSE locks them out.
-- Members never lose visibility of their own rows regardless of the
-- override.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cap.test');
  v_coach uuid := _test_mk_user('coach@cap.test');
  v_m     uuid := _test_mk_user('member@cap.test');
  v_gym   uuid := _test_mk_gym('Cap Gym', 'cap-gym');
  v_w     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_m,     'member');

  perform _test_act_as(v_owner);
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_m)
    returning id into v_w;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.m',     v_m::text,     true);
end;
$$;

-- Default state: coach sees the member's workout.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workouts
    where profile_id = current_setting('test.m')::uuid)::int,
  1,
  'coach can SELECT member workouts when can_see_workout_logs is default-on'
);

-- Owner flips the coach override OFF.
do $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner
    from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and role = 'owner'
    limit 1;
  perform _test_act_as(v_owner);
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (current_setting('test.gym')::uuid, 'coach', 'can_see_workout_logs', false);
end;
$$;

-- Coach now blocked.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workouts
    where profile_id = current_setting('test.m')::uuid)::int,
  0,
  'coach is locked out when can_see_workout_logs override is flipped off'
);

-- Member always sees their own row regardless of the override.
do $$
begin
  perform _test_act_as(current_setting('test.m')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workouts
    where profile_id = current_setting('test.m')::uuid)::int,
  1,
  'member always sees their own tracked_workouts regardless of capability override'
);

select * from finish();
rollback;
