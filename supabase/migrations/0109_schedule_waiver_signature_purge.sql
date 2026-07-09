-- 0109_schedule_waiver_signature_purge.sql
--
-- Schedule purge_expired_waiver_signatures() (0108) via pg_cron, mirroring
-- the health-data purge schedule in 0095. A 6-year retention window doesn't
-- need a daily sweep — weekly is ample. cron.schedule upserts by job name,
-- so re-running this migration replaces the job rather than duplicating it.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-waiver-signatures',
  '0 4 * * 0', -- weekly, Sunday 04:00 UTC (off-peak)
  $$select public.purge_expired_waiver_signatures();$$
);
