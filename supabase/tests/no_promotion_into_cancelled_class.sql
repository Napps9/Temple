-- Regression test for the order-of-operations in _cancel_session_internal.
-- When the session is deleted, ON DELETE CASCADE deletes the booking rows.
-- The promote_from_waitlist AFTER DELETE trigger fires per booking. Without
-- the load-bearing order in our cancel helper (waitlist deleted FIRST, then
-- session), the trigger would happily promote a waitlister into a session
-- that's about to vanish — or that has already vanished depending on cascade
-- timing.
--
-- This test puts a member on the waitlist, has another booked, then cancels
-- the session. The waitlister must NOT end up with a booking afterwards.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@nopromcancel.test');
  v_gym   uuid := _test_mk_gym('No Prom', 'nopromcancel');
  v_a     uuid := _test_mk_user('a@nopromcancel.test');
  v_w     uuid := _test_mk_user('w@nopromcancel.test');
  v_mid_w uuid;
  v_plan  uuid;
  v_ct    uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid_w := _test_mk_membership(v_gym, v_w, 'member');

  -- Waitlister has an active sub so they would be eligible if promotion fired.
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid_w, v_w, v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  perform _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_w, 1);

  perform set_config('test.sess', v_sess::text, true);
  perform set_config('test.w',    v_w::text,    true);

  perform _test_act_as(v_owner);
  perform public.cancel_session(v_sess);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  0,
  'session deleted'
);

select is(
  (select count(*)::int from public.class_bookings
    where profile_id = current_setting('test.w')::uuid),
  0,
  'waitlister did NOT get a booking — no spurious promotion into a cancelled class'
);

select is(
  (select count(*)::int from public.class_waitlist
    where profile_id = current_setting('test.w')::uuid),
  0,
  'waitlist row gone too (deleted by cancel helper, step 2)'
);

select * from finish();
rollback;
