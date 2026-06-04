-- Invariant: a cover request cannot strand a class without a coach.
--
-- claim_cover never nulls class_sessions.coach_id. If the cover
-- request is cancelled before any claim, the original coach is
-- retained. If the request is in a partial state, the unclaimed
-- offers can be cancelled by their requester or an admin.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@strand.test');
  v_coach  uuid := _test_mk_user('coach@strand.test');
  v_gym    uuid := _test_mk_gym('Strand Gym', 'strand');
  v_session uuid;
  v_request uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  v_session := _test_mk_session(v_gym, v_coach, now() + interval '1 day');

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach, now() + interval '1 day', now() + interval '1 day 1 hour')
  returning id into v_request;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request, v_session, v_coach, v_gym);

  -- Coach cancels their own unclaimed request.
  perform _test_act_as(v_coach);
  perform cancel_cover_request(v_request);

  perform set_config('test.session', v_session::text, true);
  perform set_config('test.coach',   v_coach::text,   true);
  perform set_config('test.request', v_request::text, true);
end;
$$;

select is(
  (select coach_id::text
   from public.class_sessions
   where id = current_setting('test.session')::uuid),
  current_setting('test.coach'),
  'class retains its original coach after request cancellation'
);

select is(
  (select status
   from public.cover_requests
   where id = current_setting('test.request')::uuid),
  'cancelled',
  'request status moves to cancelled'
);

select * from finish();
rollback;
