-- Invariant: only one coach can claim a given cover offer.
--
-- True multi-transaction concurrency is hard to exercise inside a
-- single pgTAP file; the FOR UPDATE lock and the
-- claimed_by IS NULL filter together make double-claim impossible
-- at the storage layer. This test stands in for the concurrency
-- guarantee by sequencing two claim attempts: the first succeeds,
-- the second on the now-claimed offer raises.

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@conc.test');
  v_coach_a uuid := _test_mk_user('coach_a@conc.test');
  v_coach_b uuid := _test_mk_user('coach_b@conc.test');
  v_gym     uuid := _test_mk_gym('Concurrency Gym', 'conc');
  v_session uuid;
  v_request uuid;
  v_offer   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');

  v_session := _test_mk_session(v_gym, v_coach_a, now() + interval '1 day');

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach_a, now() + interval '1 day', now() + interval '1 day 1 hour')
  returning id into v_request;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request, v_session, v_coach_a, v_gym)
  returning id into v_offer;

  -- First claim by coach B succeeds.
  perform _test_act_as(v_coach_b);
  perform claim_cover(v_offer);

  perform set_config('test.offer', v_offer::text, true);
  perform set_config('test.session', v_session::text, true);
  perform set_config('test.coach_b', v_coach_b::text, true);

  -- Now act as coach A for the second-claim throws_ok.
  perform _test_act_as(v_coach_a);
end;
$$;

select is(
  (select coach_id::text
   from public.class_sessions
   where id = current_setting('test.session')::uuid),
  current_setting('test.coach_b'),
  'class session coach swaps to coach B after first claim'
);

select is(
  (select claimed_by::text
   from public.cover_request_sessions
   where id = current_setting('test.offer')::uuid),
  current_setting('test.coach_b'),
  'offer is marked claimed_by coach B'
);

select throws_ok(
  format('select claim_cover(%L::uuid)', current_setting('test.offer')),
  null::text, null::text,
  'second claim_cover on the same offer raises'
);

select * from finish();
rollback;
