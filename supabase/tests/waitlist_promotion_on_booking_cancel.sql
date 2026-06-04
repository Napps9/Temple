-- Cancelling a booking on a full class promotes the first eligible
-- waitlister. The new booking has promoted_from_waitlist = true and
-- the waitlist row is gone.

begin;
select plan(4);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wpromote.test');
  v_gym   uuid := _test_mk_gym('Promote', 'wpromote');
  v_a     uuid := _test_mk_user('a@wpromote.test');
  v_b     uuid := _test_mk_user('b@wpromote.test');
  v_w     uuid := _test_mk_user('w@wpromote.test');
  v_plan  uuid;
  v_mid_w uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  v_mid_w := _test_mk_membership(v_gym, v_w, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  -- Give the waitlister an active sub so they're eligible.
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

  -- A books (fills capacity 1). B and W can't book. W joins waitlist.
  v_book_a := _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_w, 1);

  perform set_config('test.sess',  v_sess::text,  true);
  perform set_config('test.w',     v_w::text,     true);

  -- A cancels by deleting their booking row (RLS-allowed for self, but
  -- here the test runs as superuser; the trigger doesn't depend on
  -- the caller's auth, only on the AFTER DELETE event).
  delete from public.class_bookings where id = v_book_a;
end;
$$;

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.w')::uuid),
  1,
  'waitlister now has a booking'
);

select is(
  (select promoted_from_waitlist from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.w')::uuid),
  true,
  'promoted_from_waitlist = true on the new booking'
);

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid),
  0,
  'waitlist row deleted after promotion'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid),
  1,
  'capacity respected — exactly one booking total'
);

select * from finish();
rollback;
