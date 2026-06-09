-- A class session broadcast is visible to members who have a booking
-- on that session and to the sender, but NOT to a member with no
-- booking on that session.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@bc.test');
  v_coach uuid := _test_mk_user('coach@bc.test');
  v_a     uuid := _test_mk_user('a@bc.test'); -- booked
  v_b     uuid := _test_mk_user('b@bc.test'); -- not booked
  v_gym   uuid := _test_mk_gym('BC Gym', 'bc-gym');
  v_session uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  v_session := _test_mk_session(v_gym, v_coach, now() + interval '1 hour');
  perform _test_mk_booking(v_session, v_a);

  insert into public.class_session_broadcasts
    (gym_id, class_session_id, sender_id, body)
    values (v_gym, v_session, v_coach, 'bring a rope');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);
end;
$$;

-- Member A (booked) sees the broadcast.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.class_session_broadcasts)::int,
  1,
  'a booked attendee sees the broadcast'
);

-- Member B (not booked) does not.
do $$
begin
  perform _test_act_as(current_setting('test.b')::uuid);
end;
$$;

select is(
  (select count(*) from public.class_session_broadcasts)::int,
  0,
  'a non-booked member does not see the broadcast'
);

select * from finish();
rollback;
