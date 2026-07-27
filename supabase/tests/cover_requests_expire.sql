-- Invariant: expire_cover_requests closes out cover that can no longer
-- be claimed. 'expired' has been in the cover_requests status CHECK
-- since 0013 and nothing ever wrote it, so requests for classes that had
-- already happened sat in the feed indefinitely.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@covexp.test');
  v_coach    uuid := _test_mk_user('coach@covexp.test');
  v_gym      uuid := _test_mk_gym('Expiry Gym', 'covexp');
  v_past     uuid;
  v_future   uuid;
  v_req_gone uuid;
  v_req_live uuid;
  v_req_stale uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  v_past   := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_future := _test_mk_session(v_gym, v_coach, now() + interval '2 days');

  -- A per-class request whose only class has already run.
  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach, now() - interval '2 days', now() - interval '47 hours')
  returning id into v_req_gone;
  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values (v_req_gone, v_past, v_coach, v_gym);

  -- A per-class request whose class is still ahead.
  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach, now() + interval '2 days', now() + interval '49 hours')
  returning id into v_req_live;
  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values (v_req_live, v_future, v_coach, v_gym);

  -- A standing window that has run out, with nothing attached.
  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end,
     requested_start, requested_end)
  values
    (v_gym, v_coach, now() - interval '10 days', now() - interval '3 days',
     current_date - 10, current_date - 3)
  returning id into v_req_stale;

  perform expire_cover_requests();

  perform set_config('test.req_gone',  v_req_gone::text,  true);
  perform set_config('test.req_live',  v_req_live::text,  true);
  perform set_config('test.req_stale', v_req_stale::text, true);
  perform set_config('test.past',      v_past::text,      true);
end;
$$;

select is(
  (select count(*)::int from public.cover_request_sessions
     where class_session_id = current_setting('test.past')::uuid),
  0,
  'unclaimed offers for classes that already ran are swept away'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.req_gone')::uuid),
  'expired',
  'a request whose classes have all run is expired'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.req_live')::uuid),
  'open',
  'a request with a class still ahead is left open'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.req_stale')::uuid),
  'expired',
  'a standing window past its end date is expired'
);

select * from finish();
rollback;
