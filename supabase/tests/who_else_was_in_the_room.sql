-- class_session_training_partners (0258): the journal's avatar stack
-- rides the leaderboard consent. The caller never appears in their own
-- list; an opted-out member is invisible until they opt back in; a gym
-- the caller does not belong to is silently filtered; switching the
-- gym's class leaderboards off empties the room; anon cannot call it.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@room.test');
  v_a     uuid := _test_mk_user('caller@room.test');
  v_b     uuid := _test_mk_user('bea@room.test');
  v_c     uuid := _test_mk_user('cal@room.test');
  v_d     uuid := _test_mk_user('dee@room.test');
  v_out   uuid := _test_mk_user('elsewhere@room.test');
  v_gym   uuid := _test_mk_gym('Room Gym', 'room-gym');
  v_gym_b uuid := _test_mk_gym('Other Room', 'other-room-gym');
  v_s1    uuid;
  v_s2    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');
  perform _test_mk_membership(v_gym, v_d, 'member');
  perform _test_mk_membership(v_gym_b, v_out, 'owner');

  update public.profiles set full_name = 'Bea Partner' where id = v_b;
  update public.profiles set full_name = 'Cal Quiet'   where id = v_c;

  -- Cal opted out of leaderboards; Dee has left the gym entirely.
  update public.gym_memberships
     set appear_in_leaderboards = false
   where gym_id = v_gym and profile_id = v_c;
  update public.gym_memberships
     set left_at = now()
   where gym_id = v_gym and profile_id = v_d;

  v_s1 := _test_mk_session(v_gym, v_owner, now() - interval '1 day');
  v_s2 := _test_mk_session(v_gym_b, v_out, now() - interval '1 day');

  insert into public.tracked_workouts (gym_id, profile_id, class_session_id, performed_at)
  values
    (v_gym,   v_a,   v_s1, now() - interval '1 day'),
    (v_gym,   v_b,   v_s1, now() - interval '1 day'),
    (v_gym,   v_c,   v_s1, now() - interval '1 day'),
    (v_gym,   v_d,   v_s1, now() - interval '1 day'),
    (v_gym_b, v_out, v_s2, now() - interval '1 day');

  perform set_config('test.gym',   v_gym::text,   false);
  perform set_config('test.owner', v_owner::text, false);
  perform set_config('test.a',     v_a::text,     false);
  perform set_config('test.c',     v_c::text,     false);
  perform set_config('test.s1',    v_s1::text,    false);
  perform set_config('test.s2',    v_s2::text,    false);
end $$;

-- 1. The caller sees exactly Bea: not themselves, not opted-out Cal,
--    not departed Dee.
select _test_act_as(current_setting('test.a')::uuid);
select results_eq(
  $$select full_name from public.class_session_training_partners(
      array[current_setting('test.s1')::uuid])$$,
  $$select 'Bea Partner'::text as full_name$$,
  'only a consenting, current co-logger appears'
);

-- 2. Cal opts back in...
select _test_act_as(current_setting('test.c')::uuid);
select lives_ok(
  $$select public.set_appear_in_leaderboards(current_setting('test.gym')::uuid, true)$$,
  'the member flips their own leaderboard consent'
);

-- 3. ...and immediately shows up.
select _test_act_as(current_setting('test.a')::uuid);
select results_eq(
  $$select count(*)::integer as n from public.class_session_training_partners(
      array[current_setting('test.s1')::uuid])$$,
  $$select 2::integer as n$$,
  'opting back in makes the member visible'
);

-- 4. A session in a gym the caller does not belong to is filtered out.
select results_eq(
  $$select count(*)::integer as n from public.class_session_training_partners(
      array[current_setting('test.s1')::uuid, current_setting('test.s2')::uuid])
     where class_session_id = current_setting('test.s2')::uuid$$,
  $$select 0::integer as n$$,
  'another gym''s session yields nobody'
);

-- 5. The gym switching class leaderboards off empties the room.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.set_leaderboard_config(current_setting('test.gym')::uuid, false, true)$$,
  'the owner turns class leaderboards off'
);
select _test_act_as(current_setting('test.a')::uuid);
select results_eq(
  $$select count(*)::integer as n from public.class_session_training_partners(
      array[current_setting('test.s1')::uuid])$$,
  $$select 0::integer as n$$,
  'no class leaderboards, no training partners'
);

select * from finish();
rollback;
