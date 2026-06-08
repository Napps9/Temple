-- RLS isolation: a member cannot SELECT another member's
-- tracked_workout_sections row.

begin;
select plan(1);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@tws.test');
  v_a     uuid := _test_mk_user('a@tws.test');
  v_b     uuid := _test_mk_user('b@tws.test');
  v_gym   uuid := _test_mk_gym('Sections Gym', 'sections-gym');
  v_w_b   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  insert into public.tracked_workouts (gym_id, profile_id) values (v_gym, v_b)
    returning id into v_w_b;
  insert into public.tracked_workout_sections
    (gym_id, profile_id, workout_id, section_category, section_format, body)
    values (v_gym, v_b, v_w_b, 'wod', 'for_time', 'Fran');

  perform set_config('test.a', v_a::text, true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.tracked_workout_sections)::int,
  0,
  'member A cannot SELECT member B''s tracked_workout_sections'
);

select * from finish();
rollback;
