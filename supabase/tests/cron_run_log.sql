-- A sweep that did nothing and a sweep that could do nothing must not look
-- the same.
--
-- cron.job_run_details records the row count of the SELECT, so every job in
-- this database reports `1 row` whatever happened. That is how 0116's
-- dispatcher sat inert for months and how 0186 shipped pointing at a
-- credential the worker did not accept: nothing ever disagreed.

begin;
select plan(6);

\ir _helpers.psql

-- No Vault credential: the dispatcher cannot act. This is the case that
-- was indistinguishable from a quiet period.
select is(
  public.dispatch_scheduled_campaigns(),
  0,
  'with no credential the sweep returns zero'
);

select is(
  (select result->>'skipped' from public.cron_run_log
    where job_name = 'dispatch-scheduled-campaigns'
    order by id desc limit 1),
  'missing worker_shared_secret or worker_gateway_key in vault',
  'and says WHY it was zero, rather than reporting success'
);

select lives_ok(
  $$ select vault.create_secret('test-shared-secret', 'worker_shared_secret');
     select vault.create_secret('sb_publishable_test', 'worker_gateway_key'); $$,
  'the credential is created'
);

select is(
  public.dispatch_scheduled_campaigns(),
  0,
  'the sweep runs again with nothing due'
);

-- Same return value, different meaning. The log is the only place that
-- difference exists.
select ok(
  (select result ? 'due' and not (result ? 'skipped')
     from public.cron_run_log
    where job_name = 'dispatch-scheduled-campaigns'
    order by id desc limit 1),
  'and this zero is the other kind — it looked, and there was nothing'
);

-- The automations dispatcher records whether it reached the worker at all,
-- which is what distinguishes "nobody has an automation" from "the worker
-- is refusing us".
select lives_ok(
  $$ select public.dispatch_email_automations() $$,
  'the automations sweep runs'
);

select * from finish();
rollback;
