-- Members with appear_in_leaderboards=false are excluded from both
-- the class leaderboard and the strength leaderboard. They still see
-- their own logs elsewhere — this is just about showing-up-on-rank.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@priv.test');
  v_a     uuid := _test_mk_user('a@priv.test');
  v_b     uuid := _test_mk_user('b@priv.test');
  v_gym   uuid := _test_mk_gym('Privacy Gym', 'priv-gym');
  v_ct    uuid;
  v_prog  uuid;
  v_w_a   uuid;
  v_w_b   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  -- B opts out.
  update public.gym_memberships
    set appear_in_leaderboards = false
    where gym_id = v_gym and profile_id = v_b;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#FF0000') returning id into v_ct;
  insert into public.class_programming
    (gym_id, class_type_id, date, sections, author_id)
    values (v_gym, v_ct, current_date,
            '[{"section_category":"wod","section_format":"for_time"}]'::jsonb,
            v_owner)
    returning id into v_prog;

  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_a) returning id into v_w_a;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b) returning id into v_w_b;

  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, source_programming_id, source_section_index,
     section_category, section_format, total_time_seconds)
  values
    (v_gym, v_a, v_w_a, v_prog, 0, 'wod', 'for_time', 250),
    (v_gym, v_b, v_w_b, v_prog, 0, 'wod', 'for_time', 180);

  -- A direct strength PR for each.
  insert into public.tracked_movement_results
    (gym_id, profile_id, workout_id, movement_key, track_key, value_numeric, value_unit)
  values
    (v_gym, v_a, v_w_a, 'back_squat', '1rm', 100, 'kg'),
    (v_gym, v_b, v_w_b, 'back_squat', '1rm', 140, 'kg');

  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.prog', v_prog::text, true);
  perform set_config('test.a',    v_a::text,    true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.class_leaderboard(current_setting('test.prog')::uuid, 0))::int,
  1,
  'opted-out member is hidden from class leaderboard'
);

select is(
  (select count(*) from public.strength_leaderboard(
    current_setting('test.gym')::uuid,
    'back_squat', '1rm', 'weight', 'higher'
  ))::int,
  1,
  'opted-out member is hidden from strength leaderboard'
);

select * from finish();
rollback;
