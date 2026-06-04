-- A waitlister with left_at IS NOT NULL is skipped during promotion.
-- The next eligible waitlister gets the seat. Proves left_at
-- propagates through is_booking_eligible (which the trigger consults).
--
-- The stale waitlist row stays in the table — leave_gym is what
-- prunes the member's waitlist entries; setting left_at directly
-- here doesn't trigger that cleanup. (Real flow goes through
-- leave_gym, covered by leave_gym_prunes_waitlist.sql.)

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wskipleft.test');
  v_gym   uuid := _test_mk_gym('Skip Left', 'wskipleft');
  v_a     uuid := _test_mk_user('a@wskipleft.test');
  v_left  uuid := _test_mk_user('left@wskipleft.test');
  v_ok    uuid := _test_mk_user('ok@wskipleft.test');
  v_plan  uuid;
  v_mid_l uuid;
  v_mid_o uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid_l := _test_mk_membership(v_gym, v_left, 'member');
  v_mid_o := _test_mk_membership(v_gym, v_ok, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid_l, v_left, v_gym, v_plan, 'active'::public.plan_sub_state),
    (v_mid_o, v_ok,   v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  v_book_a := _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position) values
    (v_gym, v_sess, v_left, 1),
    (v_gym, v_sess, v_ok,   2);

  -- Set left_at directly so the predicate, not leave_gym, is what we
  -- exercise here.
  update public.gym_memberships
    set left_at = now()
    where gym_id = v_gym and profile_id = v_left;

  perform set_config('test.sess', v_sess::text, true);
  perform set_config('test.left', v_left::text, true);
  perform set_config('test.ok',   v_ok::text,   true);

  delete from public.class_bookings where id = v_book_a;
end;
$$;

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.ok')::uuid),
  1,
  'eligible waitlister (position 2) got the seat'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.left')::uuid),
  0,
  'left member did not get promoted'
);

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.left')::uuid),
  1,
  'left member stays in waitlist data (skipped, not consumed)'
);

select * from finish();
rollback;
