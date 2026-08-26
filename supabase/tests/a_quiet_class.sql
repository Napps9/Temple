-- 0266: what a member is told about how full a class is.
--
-- Test 3 is the regression: "Full — N waiting" was rendered from a plain
-- select on class_waitlist, whose policy hands a member only their own
-- row, so a queue of three read as one. The definer count is what makes
-- the number true for somebody who is not staff.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@quiet.test');
  v_a     uuid := _test_mk_user('ann@quiet.test');
  v_b     uuid := _test_mk_user('ben@quiet.test');
  v_c     uuid := _test_mk_user('cat@quiet.test');
  v_d     uuid := _test_mk_user('dan@quiet.test');
  v_gym   uuid := _test_mk_gym('Quiet Gym', 'quiet-gym');
  v_s     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');
  perform _test_mk_membership(v_gym, v_d, 'member');

  v_s := _test_mk_session(v_gym, v_owner, now() + interval '2 days');
  update public.class_sessions set capacity = 2 where id = v_s;

  -- Two booked (full), three waiting.
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, v_s, v_a), (v_gym, v_s, v_b);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
  values (v_gym, v_s, v_c, 1), (v_gym, v_s, v_d, 2), (v_gym, v_s, v_owner, 3);

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.session', v_s::text, false);
  perform set_config('test.ann', v_a::text, false);
  perform set_config('test.cat', v_c::text, false);
  perform set_config('test.owner', v_owner::text, false);
end $$;

-- 1. A member reads only their own booking row now.
select _test_act_as(current_setting('test.ann')::uuid);
select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.session')::uuid),
  1,
  'a member sees only their own booking row'
);

-- 2. The count RPC still tells them the true taken figure.
select is(
  (select taken from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  2,
  'taken is the real number, not what the member can select'
);

-- 3. REGRESSION: the waiting count is true for a member.
select is(
  (select waiting from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  3,
  'waiting counts the whole queue, not just the caller'
);

-- 4. Full is full.
select ok(
  (select is_full from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  'a class at capacity reports is_full'
);

-- 5-7. Switch the numbers off: counts go null, is_full survives.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format('select public.set_class_capacity_visibility(%L, false)',
         current_setting('test.gym')),
  'an owner can turn the numbers off'
);

select _test_act_as(current_setting('test.ann')::uuid);
select is(
  (select taken from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  null,
  'taken is withheld when the gym hides capacity'
);

select ok(
  (select is_full from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  'is_full is still told — hiding it would offer a booking the server refuses'
);

-- 8. Staff still see the numbers with the switch off.
select _test_act_as(current_setting('test.owner')::uuid);
select is(
  (select taken from public.class_session_spot_counts(
     array[current_setting('test.session')::uuid])),
  2,
  'staff see counts regardless of the switch'
);

-- 9. Only an owner may flip it.
select _test_act_as(current_setting('test.cat')::uuid);
select throws_ok(
  format('select public.set_class_capacity_visibility(%L, true)',
         current_setting('test.gym')),
  'Only an owner can change what members see',
  'a member cannot change what the gym publishes'
);

select * from finish();
rollback;
