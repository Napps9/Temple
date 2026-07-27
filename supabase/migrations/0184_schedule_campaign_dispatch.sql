-- Schedule dispatch_scheduled_campaigns() (0183) via pg_cron, mirroring
-- the automations dispatcher (0117). Every 15 minutes: a newsletter that
-- goes out a few minutes after the stated time is fine, and a tighter
-- cadence would mean 96 more wake-ups a day for a table that is usually
-- empty. cron.schedule upserts by job name, so re-running is idempotent.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'dispatch-scheduled-campaigns',
  '*/15 * * * *',
  $$select public.dispatch_scheduled_campaigns();$$
);
