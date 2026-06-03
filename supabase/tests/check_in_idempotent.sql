-- Invariant: check_in_member is a strict no-op when already attended.
--
-- The plan committed to "no time window for idempotency" — a second
-- call to check_in_member after the first must not bounce marked_by
-- or rewrite attended_at, regardless of how much time has passed.

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@checkin-idem.test');
  v_coach   uuid := _test_mk_user('coach@checkin-idem.test');
  v_member  uuid := _test_mk_user('member@checkin-idem.test');
  v_gym     uuid := _test_mk_gym('Idem Gym', 'idem');
  v_session uuid;
  v_booking uuid;
  v_first_marked_by uuid;
  v_first_attended_at timestamptz;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  v_session := _test_mk_session(v_gym, v_coach, now() - interval '5 minutes');
  v_booking := _test_mk_booking(v_session, v_member);

  -- First check-in by the coach.
  perform _test_act_as(v_coach);
  perform check_in_member(v_booking);

  select marked_by, attended_at
    into v_first_marked_by, v_first_attended_at
  from public.class_bookings where id = v_booking;

  perform set_config('test.first_marked_by', v_first_marked_by::text, true);
  perform set_config('test.first_attended_at', v_first_attended_at::text, true);

  -- Sleep a beat so any time-based rewrite would be visible.
  perform pg_sleep(0.05);

  -- Second check-in by the owner — should be a no-op.
  perform _test_act_as(v_owner);
  perform check_in_member(v_booking);

  perform set_config('test.booking', v_booking::text, true);
end;
$$;

select is(
  (select marked_by::text
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  current_setting('test.first_marked_by'),
  'second check_in_member call does not rewrite marked_by'
);

select is(
  (select attended_at::text
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  current_setting('test.first_attended_at'),
  'second check_in_member call does not rewrite attended_at'
);

select ok(
  (select no_show = false
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  'no_show stays false through idempotent check-ins'
);

select * from finish();
rollback;
