-- Strength leaderboard merges direct PR rows (tracked_movement_results)
-- and section-tagged rows (tracked_section_movement_tags joined to
-- entries). Each member's BEST across both sources is ranked.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sl.test');
  v_a     uuid := _test_mk_user('a@sl.test');
  v_b     uuid := _test_mk_user('b@sl.test');
  v_gym   uuid := _test_mk_gym('Strength LB Gym', 'sl-gym');
  v_w_a   uuid;
  v_w_b   uuid;
  v_s_b   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  -- A: direct PR of 120 kg.
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_a) returning id into v_w_a;
  insert into public.tracked_movement_results
    (gym_id, profile_id, workout_id, movement_key, track_key, value_numeric, value_unit)
  values
    (v_gym, v_a, v_w_a, 'back_squat', '1rm', 120, 'kg');

  -- B: via a section + tag. Strength Sets section with two entries
  -- (110, 130). Heaviest = 130 → B should rank first.
  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b) returning id into v_w_b;
  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, section_category, section_format)
    values (v_gym, v_b, v_w_b, 'strength_and_skill', 'strength_sets')
    returning id into v_s_b;
  insert into public.tracked_section_entries
    (gym_id, profile_id, section_id, entry_index, weight_numeric, weight_unit, reps)
  values
    (v_gym, v_b, v_s_b, 1, 110, 'kg', 1),
    (v_gym, v_b, v_s_b, 2, 130, 'kg', 1);
  insert into public.tracked_section_movement_tags
    (gym_id, profile_id, section_id, movement_key, track_key, performed_at)
    values (v_gym, v_b, v_s_b, 'back_squat', '1rm', now());

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.a',   v_a::text,   true);
  perform set_config('test.b',   v_b::text,   true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.strength_leaderboard(
    current_setting('test.gym')::uuid,
    'back_squat', '1rm', 'weight', 'higher'
  ))::int,
  2,
  'both A (direct) and B (tagged) appear on the leaderboard'
);

select is(
  (select profile_id from public.strength_leaderboard(
    current_setting('test.gym')::uuid,
    'back_squat', '1rm', 'weight', 'higher'
  ) where rank = 1)::uuid,
  current_setting('test.b')::uuid,
  'B (130 kg via section tag) ranks #1 over A (120 kg direct)'
);

select is(
  (select source from public.strength_leaderboard(
    current_setting('test.gym')::uuid,
    'back_squat', '1rm', 'weight', 'higher'
  ) where rank = 1)::text,
  'tag',
  'rank-1 row carries source=tag'
);

select * from finish();
rollback;
