-- RLS isolation: a member cannot SELECT another member's movement-
-- tag rows. Coach reads them by default via can_see_workout_logs.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@tag.test');
  v_coach uuid := _test_mk_user('coach@tag.test');
  v_a     uuid := _test_mk_user('a@tag.test');
  v_b     uuid := _test_mk_user('b@tag.test');
  v_gym   uuid := _test_mk_gym('Tag Gym', 'tag-gym');
  v_w_b   uuid;
  v_s_b   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b)
    returning id into v_w_b;
  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, section_category, section_format)
    values (v_gym, v_b, v_w_b, 'strength_and_skill', 'strength_sets')
    returning id into v_s_b;
  insert into public.tracked_section_movement_tags
    (gym_id, profile_id, section_id, movement_key, track_key, performed_at)
    values (v_gym, v_b, v_s_b, 'back_squat', '1rm', now());

  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- Member A cannot see member B's tags.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_section_movement_tags)::int,
  0,
  'member A cannot SELECT member B''s tracked_section_movement_tags'
);

-- Coach can see them (capability default ON).
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_section_movement_tags)::int,
  1,
  'coach can SELECT member tags by default'
);

select * from finish();
rollback;
