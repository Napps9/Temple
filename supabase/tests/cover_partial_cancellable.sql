-- Invariant: a cover request whose offers are only partly claimed can
-- still be withdrawn. 0014 refused unless status = 'open' with nothing
-- claimed, so a single claim froze the request permanently — tolerable
-- for two classes, unacceptable for a two-week range.
--
-- Cancelling drops the unclaimed offers and leaves the claimed one, and
-- the coach swap it already performed, untouched.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covpart.test');
  v_coach_a uuid := _test_mk_user('coach_a@covpart.test');
  v_coach_b uuid := _test_mk_user('coach_b@covpart.test');
  v_gym     uuid := _test_mk_gym('Partial Gym', 'covpart');
  v_start   date := (current_date + 5);
  v_end     date := (current_date + 7);
  v_one     uuid;
  v_two     uuid;
  v_three   uuid;
  v_request uuid;
  v_offer   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');

  v_one := _test_mk_session(v_gym, v_coach_a,
    (v_start::text || ' 06:00')::timestamp at time zone 'UTC');
  v_two := _test_mk_session(v_gym, v_coach_a,
    ((v_start + 1)::text || ' 06:00')::timestamp at time zone 'UTC');
  v_three := _test_mk_session(v_gym, v_coach_a,
    (v_end::text || ' 06:00')::timestamp at time zone 'UTC');

  perform _test_act_as(v_coach_a);
  v_request := request_cover_range(v_gym, v_start, v_end, null::uuid[], null::text);

  select id into v_offer from public.cover_request_sessions
    where request_id = v_request and class_session_id = v_two;

  -- Coach B takes one of the three.
  perform _test_act_as(v_coach_b);
  perform claim_cover(v_offer);

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.two',     v_two::text,     true);
  perform set_config('test.coach_a', v_coach_a::text, true);
  perform set_config('test.coach_b', v_coach_b::text, true);
end;
$$;

select is(
  (select status from public.cover_requests
     where id = current_setting('test.request')::uuid),
  'partial',
  'one claim of three rolls the request to partial'
);

do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;

select lives_ok(
  format('select cancel_cover_request(%L::uuid)',
         current_setting('test.request')),
  'the requester can still cancel a partially-claimed request'
);

select is(
  (select count(*)::int from public.cover_request_sessions
     where request_id = current_setting('test.request')::uuid),
  1,
  'the unclaimed offers are withdrawn'
);

select is(
  (select coach_id::text from public.class_sessions
     where id = current_setting('test.two')::uuid),
  current_setting('test.coach_b'),
  'the claimed class keeps its new coach'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.request')::uuid),
  'cancelled',
  'the request reads cancelled afterwards'
);

select * from finish();
rollback;
