-- Schedule the email-automation sweep.
--
-- dispatch_email_automations() (0116) enqueues due runs and best-effort
-- fires the send-email-automations worker. Nothing calls it on its own, so
-- wire it to pg_cron every 15 minutes — the same enable-via-migration
-- pattern as the purge sweeps (0115) and the security monitor (0112).
--
-- 15 minutes is a deliberate floor on how "late" a delayed send can be; the
-- delays owners configure are in hours/days, so quarter-hour granularity is
-- ample. cron.schedule upserts by job name, so re-running is idempotent.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'dispatch-email-automations',
  '*/15 * * * *',
  $$select public.dispatch_email_automations();$$
);
