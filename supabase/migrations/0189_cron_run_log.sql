-- Make the scheduled sweeps say what they did.
--
-- Thirteen pg_cron jobs run against this database and every one of them is
-- `select public.some_function();` returning a count that nothing captures.
-- cron.job_run_details records `return_message = '1 row'` — the row count
-- of the SELECT, not the value — so a sweep that purged 400 rows and a
-- sweep that did nothing are indistinguishable, and so are a dispatcher
-- that mailed forty campaigns and one that silently bailed on a missing
-- credential.
--
-- That is the same blindness that let 0116's dispatcher sit inert for
-- months and let 0186 ship with the wrong credential: at no point does
-- anything disagree with anything. "succeeded" is not evidence of work.
--
-- So: one row per run, with whatever the job actually did.

begin;

create table public.cron_run_log (
  id          bigserial primary key,
  job_name    text not null,
  ran_at      timestamptz not null default now(),
  duration_ms integer,
  ok          boolean not null default true,
  result      jsonb,
  error       text
);

create index cron_run_log_job_idx on public.cron_run_log(job_name, ran_at desc);

-- Ops table, not app data: no policies, so only definer functions and the
-- service role reach it. There is no per-gym dimension to scope it by and
-- no screen that shows it — it is read from the SQL editor.
alter table public.cron_run_log enable row level security;

create or replace function public._log_cron_run(
  p_job    text,
  p_result jsonb,
  p_ms     integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cron_run_log (job_name, result, duration_ms)
    values (p_job, p_result, p_ms);

  -- Trimmed here rather than by another cron job, which would need its own
  -- logging and be one more thing that can quietly stop. Ninety days is
  -- long enough to answer "has this ever worked" — the question that took
  -- all night to answer without it.
  delete from public.cron_run_log where ran_at < now() - interval '90 days';
end;
$$;

revoke execute on function public._log_cron_run(text, jsonb, integer)
  from public, anon, authenticated;

-- ============================================================================
-- The eleven counting sweeps: wrapped at the schedule, bodies untouched
-- ============================================================================
--
-- Each returns an integer, so `to_jsonb(fn())` is the whole story and the
-- function itself needs no edit — which matters, because rewriting eleven
-- working sweeps to add logging is a much bigger risk than re-registering
-- eleven cron entries. cron.schedule upserts by job name.
--
-- If the wrapped function raises, nothing is logged: the insert never runs.
-- That case is already visible in cron.job_run_details as a failed run, so
-- the two together cover both outcomes.
--
-- Every schedule expression below is copied from the migration that first
-- registered the job, not rewritten — re-registering is the one operation
-- here that can silently change WHEN something runs.

select cron.schedule('purge-expired-health-data', '0 3 * * *',
  $$select public._log_cron_run('purge-expired-health-data',
      to_jsonb(public.purge_expired_health_data()));$$);

select cron.schedule('purge-expired-waiver-signatures', '0 4 * * 0',
  $$select public._log_cron_run('purge-expired-waiver-signatures',
      to_jsonb(public.purge_expired_waiver_signatures()));$$);

select cron.schedule('security-monitor', '*/15 * * * *',
  $$select public._log_cron_run('security-monitor',
      to_jsonb(public.run_security_monitor()));$$);

select cron.schedule('purge-expired-leads', '30 3 * * *',
  $$select public._log_cron_run('purge-expired-leads',
      to_jsonb(public.purge_expired_leads()));$$);

select cron.schedule('expire-unbilled-legacy-subscriptions', '30 3 * * *',
  $$select public._log_cron_run('expire-unbilled-legacy-subscriptions',
      to_jsonb(public.expire_unbilled_legacy_subscriptions()));$$);

select cron.schedule('purge-expired-agent-recordings', '0 4 * * *',
  $$select public._log_cron_run('purge-expired-agent-recordings',
      to_jsonb(public.purge_expired_agent_recordings()));$$);

select cron.schedule('purge-expired-agent-conversations', '30 4 * * *',
  $$select public._log_cron_run('purge-expired-agent-conversations',
      to_jsonb(public.purge_expired_agent_conversations()));$$);

select cron.schedule('flag-stale-leads', '15 5 * * *',
  $$select public._log_cron_run('flag-stale-leads',
      to_jsonb(public.flag_stale_leads()));$$);

select cron.schedule('expire-cover-requests', '0 4 * * *',
  $$select public._log_cron_run('expire-cover-requests',
      to_jsonb(public.expire_cover_requests()));$$);

select cron.schedule('warn-uncovered-cover', '30 3 * * *',
  $$select public._log_cron_run('warn-uncovered-cover',
      to_jsonb(public.warn_uncovered_cover()));$$);

select cron.schedule('purge-expired-payment-data', '30 4 * * 0',
  $$select public._log_cron_run('purge-expired-payment-data',
      to_jsonb(public.purge_expired_payment_data()));$$);

commit;
