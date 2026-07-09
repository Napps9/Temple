-- Schedule the lead-retention sweep.
--
-- purge_expired_leads() (0108) deletes unconverted leads past their gym's
-- lead_retention_days window, but nothing calls it on its own. This wires
-- it to pg_cron, mirroring the health-data purge in 0095 — same
-- enable-via-migration pattern, same off-peak slot (staggered 30 minutes
-- after the health sweep so the two don't contend).
--
-- cron.schedule upserts by job name, so re-running is idempotent.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-leads',
  '30 3 * * *', -- daily at 03:30 UTC, just after the health-data purge
  $$select public.purge_expired_leads();$$
);
