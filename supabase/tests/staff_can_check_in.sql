-- Invariant: staff (front-desk role) can check members in.
--
-- The capability matrix in src/lib/can.ts grants can_check_in_member
-- to staff. If the SQL gate (check_in_member RPC) excluded staff, the
-- person who actually marks attendance at the door couldn't.
-- check_in_member gates on user_can_access_staff_area, which includes
-- staff by design.

begin;
select plan(3);

\ir _helpers.sql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@check-in.test');
  v_staff   uuid := _test_mk_user('staff@check-in.test');
  v_member  uuid := _test_mk_user('member@check-in.test');
  v_gym     uuid := _test_mk_gym('Check-in Gym', 'check-in');
  v_session uuid;
  v_booking uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_staff,  'staff');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Session that started 5 minutes ago — within the check-in window.
  v_session := _test_mk_session(v_gym, v_owner, now() - interval '5 minutes');
  v_booking := _test_mk_booking(v_session, v_member);

  perform _test_act_as(v_staff);
  perform check_in_member(v_booking);

  perform set_config('test.booking', v_booking::text, true);
end;
$$;

select ok(
  (select attended_at is not null
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  'staff successfully marked the booking attended_at'
);

select ok(
  (select marked_by is not null
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  'marked_by is recorded'
);

select ok(
  (select no_show = false
   from public.class_bookings
   where id = current_setting('test.booking')::uuid),
  'no_show is false after check-in'
);

select * from finish();
rollback;
