-- Invariant: claim_cover refuses to put one coach in two places at
-- once. If the caller already coaches a class whose time window
-- overlaps the offer's session, the claim must raise.

begin;
select plan(2);

\i tests/_helpers.sql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@dbl.test');
  v_coach_a uuid := _test_mk_user('coach_a@dbl.test');
  v_coach_b uuid := _test_mk_user('coach_b@dbl.test');
  v_gym     uuid := _test_mk_gym('Double-book Gym', 'dbl');
  v_session_a uuid;
  v_session_b uuid;
  v_request   uuid;
  v_offer     uuid;
  v_at        timestamptz := now() + interval '2 days';
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');

  -- Coach A's class needing cover.
  v_session_a := _test_mk_session(v_gym, v_coach_a, v_at);
  -- Coach B is already scheduled at the exact same time.
  v_session_b := _test_mk_session(v_gym, v_coach_b, v_at);

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach_a, v_at, v_at + interval '1 hour')
  returning id into v_request;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request, v_session_a, v_coach_a, v_gym)
  returning id into v_offer;

  perform set_config('test.offer',     v_offer::text,     true);
  perform set_config('test.session_a', v_session_a::text, true);
  perform set_config('test.coach_a',   v_coach_a::text,   true);

  -- Act as coach B for the claim attempt.
  perform _test_act_as(v_coach_b);
end;
$$;

select throws_ok(
  format('select claim_cover(%L::uuid)', current_setting('test.offer')),
  null::text, null::text,
  'claim_cover raises when caller already coaches an overlapping class'
);

select is(
  (select coach_id::text
   from public.class_sessions
   where id = current_setting('test.session_a')::uuid),
  current_setting('test.coach_a'),
  'session retains its original coach after failed claim'
);

select * from finish();
rollback;
