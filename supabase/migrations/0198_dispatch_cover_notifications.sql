-- The nightly uncovered-cover warning email had no server-side drainer.
--
-- warn_uncovered_cover (0166/0191) runs on cron at 03:30 and enqueues, for
-- every class that is imminent and still uncovered, an in-app notice (which
-- lands immediately — it IS the row) and a queued email. The email is
-- drained by the send-cover-notifications worker, which until now was only
-- ever invoked from the client — CoverRequestCard and the cover screen,
-- best-effort, when a human is looking. The cron has no human, so its
-- emails sat 'queued' until someone happened to open the cover screen at
-- that gym. For the exact case the feature exists to catch — a class about
-- to run unstaffed that nobody is engaging with — that is precisely the
-- activity that is not happening, so the warning email typically never
-- sent before the class.
--
-- This is the same enqueue-with-no-drainer shape as the campaign and
-- automation dispatchers, and gets the same fix: a cron job that drains
-- the queue through the worker, authenticated with the service key from
-- Vault. The worker is gym-scoped, so the dispatcher POSTs once per gym
-- that has a queued cover email. It also backstops a cover-REQUEST email
-- whose client-side drain failed, since it drains the whole queued set
-- regardless of who enqueued it.
--
-- Reuses the worker_service_key Vault row created for the campaign
-- dispatcher (0186) — no new setup. If the row is absent the dispatcher
-- logs why and sends nothing, the same visible-not-silent behaviour as the
-- others.

begin;

create or replace function public.dispatch_cover_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     record;
  v_gyms    integer := 0;
  v_posted  integer := 0;
  v_queued  integer;
  v_started timestamptz := clock_timestamp();
  v_key     text := public._worker_service_key();
begin
  select count(*)::int into v_queued
    from public.cover_notifications
    where channel = 'email' and status = 'queued';

  if v_key is null then
    perform public._log_cron_run('dispatch-cover-notifications',
      jsonb_build_object('skipped', 'no worker_service_key in vault',
                         'queued', v_queued));
    return 0;
  end if;

  for v_gym in
    select distinct gym_id from public.cover_notifications
    where channel = 'email' and status = 'queued'
  loop
    v_gyms := v_gyms + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-cover-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('gym_id', v_gym.gym_id)
      );
      v_posted := v_posted + 1;
    exception when others then
      -- pg_net missing or endpoint down: leave the rows queued for the
      -- next sweep rather than aborting the whole run.
      null;
    end;
  end loop;

  perform public._log_cron_run('dispatch-cover-notifications',
    jsonb_build_object('queued', v_queued, 'gyms', v_gyms, 'posted', v_posted,
                       'has_key', true),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_posted;
end;
$$;

revoke execute on function public.dispatch_cover_notifications()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- Every 15 minutes, same cadence as the campaign dispatcher: the warning
-- is time-sensitive but the enqueue happens once a night, so a quarter-hour
-- of latency is fine and the table is usually empty. Upserts by job name.
select cron.schedule(
  'dispatch-cover-notifications',
  '*/15 * * * *',
  $$select public.dispatch_cover_notifications();$$
);

commit;
