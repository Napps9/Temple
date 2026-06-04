-- The promotion trigger skips ineligible waitlisters (paused plan in
-- this case) and promotes the next eligible one. The skipped entry
-- stays on the waitlist; the eligible one gets the seat.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wskip.test');
  v_gym   uuid := _test_mk_gym('Skip', 'wskip');
  v_a     uuid := _test_mk_user('a@wskip.test');
  v_paused uuid := _test_mk_user('paused@wskip.test');
  v_ok     uuid := _test_mk_user('ok@wskip.test');
  v_plan  uuid;
  v_mid_p uuid;
  v_mid_o uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid_p := _test_mk_membership(v_gym, v_paused, 'member');
  v_mid_o := _test_mk_membership(v_gym, v_ok, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid_p, v_paused, v_gym, v_plan, 'paused'::public.plan_sub_state);
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid_o, v_ok, v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  v_book_a := _test_mk_booking(v_sess, v_a);
  -- paused user at position 1, ok user at position 2
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_paused, 1);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_ok, 2);

  perform set_config('test.sess',  v_sess::text,  true);
  perform set_config('test.paused', v_paused::text, true);
  perform set_config('test.ok',     v_ok::text,    true);

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
      and profile_id = current_setting('test.paused')::uuid),
  0,
  'ineligible waitlister did not get a booking'
);

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.paused')::uuid),
  1,
  'ineligible waitlister stays in the waitlist (skipped, not consumed)'
);

select * from finish();
rollback;
