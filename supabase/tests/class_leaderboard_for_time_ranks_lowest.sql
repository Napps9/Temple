-- For-time class leaderboard: fastest time wins. Verifies the
-- per-format scoring (negative-of-time so lower is "more positive").

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cl.test');
  v_a     uuid := _test_mk_user('a@cl.test');
  v_b     uuid := _test_mk_user('b@cl.test');
  v_c     uuid := _test_mk_user('c@cl.test');
  v_gym   uuid := _test_mk_gym('CL Gym', 'cl-gym');
  v_ct    uuid;
  v_prog  uuid;
  v_w_a   uuid;
  v_w_b   uuid;
  v_w_c   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');
  perform _test_mk_membership(v_gym, v_c,     'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#FF0000') returning id into v_ct;
  insert into public.class_programming
    (gym_id, class_type_id, date, sections, author_id)
    values (v_gym, v_ct, current_date,
            '[{"section_category":"wod","section_format":"for_time","title":"Fran","body":"21-15-9 thrusters + pull ups"}]'::jsonb,
            v_owner)
    returning id into v_prog;

  -- Three members log the section with times 4:00 / 5:30 / 3:15.
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_a) returning id into v_w_a;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b) returning id into v_w_b;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_c) returning id into v_w_c;

  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, source_programming_id, source_section_index,
     section_category, section_format, total_time_seconds)
  values
    (v_gym, v_a, v_w_a, v_prog, 0, 'wod', 'for_time', 240),
    (v_gym, v_b, v_w_b, v_prog, 0, 'wod', 'for_time', 330),
    (v_gym, v_c, v_w_c, v_prog, 0, 'wod', 'for_time', 195);

  perform set_config('test.prog', v_prog::text, true);
  perform set_config('test.a',    v_a::text,    true);
  perform set_config('test.c',    v_c::text,    true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select rank from public.class_leaderboard(current_setting('test.prog')::uuid, 0)
    where profile_id = current_setting('test.c')::uuid)::int,
  1,
  'fastest (3:15) ranks #1'
);

select is(
  (select count(*) from public.class_leaderboard(current_setting('test.prog')::uuid, 0))::int,
  3,
  'all three members appear'
);

select is(
  (select total_time_seconds from public.class_leaderboard(current_setting('test.prog')::uuid, 0)
    where rank = 1)::int,
  195,
  'top of the board carries the right total_time_seconds'
);

select * from finish();
rollback;
