-- A booking cutoff governs new member bookings, not waitlist
-- promotions. When the gym sets booking_cutoff_minutes_before and a
-- member drops out inside that window, the next waitlister must still
-- be promoted into the freed seat (0065 passes p_enforce_windows =
-- false from promote_from_waitlist).

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wpc.test');
  v_gym   uuid := _test_mk_gym('Promote Cutoff', 'wpc-gym');
  v_a     uuid := _test_mk_user('a@wpc.test');
  v_w     uuid := _test_mk_user('w@wpc.test');
  v_plan  uuid;
  v_mid_w uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid_w := _test_mk_membership(v_gym, v_w, 'member');

  -- A 60-minute booking cutoff: a member can't newly book inside the
  -- last hour. The session below starts in 30 minutes — inside it.
  update public.gyms set booking_cutoff_minutes_before = 60 where id = v_gym;

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid_w, v_w, v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981') returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values (v_gym, 'Sess', v_owner, now() + interval '30 minutes', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  -- A holds the single seat; W waits.
  v_book_a := _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_w, 1);

  perform set_config('test.sess', v_sess::text, true);
  perform set_config('test.w',    v_w::text,    true);

  -- A drops out inside the cutoff window.
  delete from public.class_bookings where id = v_book_a;
end $$;

select is(
  (select count(*)::int from public.class_bookings
   where class_session_id = current_setting('test.sess')::uuid
     and profile_id = current_setting('test.w')::uuid),
  1,
  'the waitlister is promoted even though the class is inside the booking cutoff'
);

select is(
  (select count(*)::int from public.class_waitlist
   where class_session_id = current_setting('test.sess')::uuid),
  0,
  'the waitlist row is consumed by the promotion'
);

select * from finish();
rollback;
