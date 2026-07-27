-- Invariant: a cover request header never outlives its offers in a
-- stale state. cancel_session (0018) deletes the class and lets ON
-- DELETE CASCADE take the cover_request_sessions rows, which used to
-- leave the header sitting at 'open' with nothing behind it.
--
-- The one exception is a standing date range whose window is still in
-- the future: an empty window is a legitimate state there, because
-- classes scheduled into it later will attach.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@covroll.test');
  v_coach    uuid := _test_mk_user('coach@covroll.test');
  v_gym      uuid := _test_mk_gym('Rollup Gym', 'covroll');
  v_at       timestamptz := now() + interval '3 days';
  v_single   uuid;
  v_ranged   uuid;
  v_req_one  uuid;
  v_req_rng  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  v_single := _test_mk_session(v_gym, v_coach, v_at);
  v_ranged := _test_mk_session(v_gym, v_coach,
    ((current_date + 25)::text || ' 09:00')::timestamp at time zone 'UTC');

  perform _test_act_as(v_coach);
  v_req_one := request_cover(array[v_single], null::text);
  v_req_rng := request_cover_range(
    v_gym, (current_date + 20), (current_date + 30), null::uuid[], null::text);

  -- The owner cancels both classes outright.
  perform _test_act_as(v_owner);
  perform cancel_session(v_single);
  perform cancel_session(v_ranged);

  perform set_config('test.req_one', v_req_one::text, true);
  perform set_config('test.req_rng', v_req_rng::text, true);
end;
$$;

select is(
  (select count(*)::int from public.cover_request_sessions
     where request_id in (
       current_setting('test.req_one')::uuid,
       current_setting('test.req_rng')::uuid
     )),
  0,
  'cancelling the classes cascades both requests down to no offers'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.req_one')::uuid),
  'expired',
  'a per-class request with no classes left is expired, not left open'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.req_rng')::uuid),
  'open',
  'a still-future standing window stays open with no classes in it'
);

select * from finish();
rollback;
