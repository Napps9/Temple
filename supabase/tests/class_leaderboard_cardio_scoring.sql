-- Cardio class leaderboards: max_distance ranks the longest distance
-- first (including the summed-splits fallback when no headline
-- aggregate was logged), max_calories ranks the most calories first.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cardio.test');
  v_a     uuid := _test_mk_user('a@cardio.test');
  v_b     uuid := _test_mk_user('b@cardio.test');
  v_c     uuid := _test_mk_user('c@cardio.test');
  v_gym   uuid := _test_mk_gym('Cardio Gym', 'cardio-gym');
  v_ct    uuid;
  v_prog  uuid;
  v_w_a   uuid;
  v_w_b   uuid;
  v_w_c   uuid;
  v_sec_b uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');
  perform _test_mk_membership(v_gym, v_c,     'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Engine', '#00AA00') returning id into v_ct;
  insert into public.class_programming
    (gym_id, class_type_id, date, sections, author_id)
    values (v_gym, v_ct, current_date,
            '[{"section_category":"wod","section_format":"max_distance","title":"20 min row","body":"20 min max distance row"},
              {"section_category":"wod","section_format":"max_calories","title":"12 min bike","body":"12 min max calories assault bike"}]'::jsonb,
            v_owner)
    returning id into v_prog;

  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_a) returning id into v_w_a;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b) returning id into v_w_b;
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_c) returning id into v_w_c;

  -- Section 0 (max_distance): A logs 4,800 m as the headline
  -- aggregate; B logs split entries only (2,600 + 2,500 = 5,100 m)
  -- to exercise the summed-entries fallback.
  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, source_programming_id, source_section_index,
     section_category, section_format, total_distance_m, total_time_seconds)
  values
    (v_gym, v_a, v_w_a, v_prog, 0, 'wod', 'max_distance', 4800, 1200);

  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, source_programming_id, source_section_index,
     section_category, section_format)
  values
    (v_gym, v_b, v_w_b, v_prog, 0, 'wod', 'max_distance')
  returning id into v_sec_b;

  insert into public.tracked_section_entries
    (gym_id, profile_id, section_id, entry_index, distance_numeric, distance_unit)
  values
    (v_gym, v_b, v_sec_b, 1, 2600, 'm'),
    (v_gym, v_b, v_sec_b, 2, 2500, 'm');

  -- Section 1 (max_calories): A 142 cal, C 155 cal.
  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, source_programming_id, source_section_index,
     section_category, section_format, total_calories)
  values
    (v_gym, v_a, v_w_a, v_prog, 1, 'wod', 'max_calories', 142),
    (v_gym, v_c, v_w_c, v_prog, 1, 'wod', 'max_calories', 155);

  perform set_config('test.prog', v_prog::text, true);
  perform set_config('test.a',    v_a::text,    true);
  perform set_config('test.b',    v_b::text,    true);
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
    where profile_id = current_setting('test.b')::uuid)::int,
  1,
  'longest distance (5,100 m via summed splits) ranks #1'
);

select is(
  (select total_distance_m from public.class_leaderboard(current_setting('test.prog')::uuid, 0)
    where rank = 1)::numeric,
  5100::numeric,
  'entries-only member surfaces the summed split distance'
);

select is(
  (select rank from public.class_leaderboard(current_setting('test.prog')::uuid, 0)
    where profile_id = current_setting('test.a')::uuid)::int,
  2,
  'headline aggregate of 4,800 m ranks #2'
);

select is(
  (select total_time_seconds from public.class_leaderboard(current_setting('test.prog')::uuid, 0)
    where profile_id = current_setting('test.a')::uuid)::int,
  1200,
  'optional total time rides along for pace display'
);

select is(
  (select rank from public.class_leaderboard(current_setting('test.prog')::uuid, 1)
    where profile_id = current_setting('test.c')::uuid)::int,
  1,
  'most calories (155) ranks #1'
);

select is(
  (select total_calories from public.class_leaderboard(current_setting('test.prog')::uuid, 1)
    where rank = 1)::int,
  155,
  'top of the calories board carries total_calories'
);

select * from finish();
rollback;
