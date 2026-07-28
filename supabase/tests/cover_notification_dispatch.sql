-- The nightly uncovered-cover warning email needs a server-side drainer.
--
-- warn_uncovered_cover enqueues the email on cron with no human present;
-- until 0198 nothing drained it unless someone opened the cover screen.
-- The dispatcher POSTs the worker per gym with a queued cover email,
-- authenticated from Vault, and is visible-not-silent when the credential
-- is missing — the same contract as the campaign dispatcher.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@covdisp.test');
  v_coach uuid := _test_mk_user('coach@covdisp.test');
  v_gym   uuid := _test_mk_gym('Cover Dispatch', 'covdisp');
  v_req   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, status)
  values (v_gym, v_coach, now() + interval '1 day', now() + interval '2 days',
          'open')
  returning id into v_req;

  -- A queued cover warning email, as warn_uncovered_cover would leave it.
  insert into public.cover_notifications
    (gym_id, request_id, kind, channel, recipient, recipient_profile_id,
     status, idempotency_key)
  values
    (v_gym, v_req, 'cover_uncovered', 'email', 'coach@covdisp.test', v_coach,
     'queued', 'email:uncovered:covdisp:test');

  perform set_config('test.gym', v_gym::text, true);
end;
$$;

-- The dispatcher is cron-only — revoked from authenticated — so run it as
-- the role pg_cron is.
select lives_ok(
  $$ select set_config('role', 'postgres', true) $$,
  'step into the role pg_cron runs as'
);

-- No Vault credential: it cannot reach the worker, and must say so rather
-- than report a quiet success.
select is(
  public.dispatch_cover_notifications(),
  0,
  'with no worker credential the dispatcher posts nothing'
);

select is(
  (select result->>'skipped' from public.cron_run_log
    where job_name = 'dispatch-cover-notifications' order by id desc limit 1),
  'no worker_service_key in vault',
  'and logs WHY it was zero'
);

-- With the credential present, it posts once for the gym that has a queued
-- email. net.http_post is a no-op in tests, so what is under test is that
-- the loop runs clean and counts the gym.
select lives_ok(
  $$ select vault.create_secret('test-service-key', 'worker_service_key') $$,
  'the one-time Vault secret is created'
);

select is(
  public.dispatch_cover_notifications(),
  1,
  'and once it exists the dispatcher posts the one gym with a queued email'
);

select * from finish();
rollback;
