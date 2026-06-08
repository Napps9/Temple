-- RLS isolation: a member cannot SELECT another member's
-- tracked_movement_results row. Backfills 0023 coverage.

begin;
select plan(1);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@tmr.test');
  v_a     uuid := _test_mk_user('a@tmr.test');
  v_b     uuid := _test_mk_user('b@tmr.test');
  v_gym   uuid := _test_mk_gym('Movement Gym', 'movement-gym');
  v_w_a   uuid;
  v_w_b   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  perform _test_act_as(v_owner);
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_a)
    returning id into v_w_a;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b)
    returning id into v_w_b;
  insert into public.tracked_movement_results
    (gym_id, profile_id, workout_id, movement_key, track_key, value_numeric)
    values (v_gym, v_b, v_w_b, 'back_squat', '1rm', 110);

  perform set_config('test.a', v_a::text, true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_movement_results)::int,
  0,
  'member A cannot SELECT member B''s tracked_movement_results'
);

select * from finish();
rollback;
