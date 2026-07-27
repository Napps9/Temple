-- Schedule purge_expired_payment_data() (0176) via pg_cron, mirroring the
-- health-data (0095) and waiver-signature (0109) sweeps. Neither window is
-- tight enough to need a daily run. cron.schedule upserts by job name, so
-- re-running this migration replaces the job rather than duplicating it.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-payment-data',
  '30 4 * * 0', -- weekly, Sunday 04:30 UTC, after the waiver sweep
  $$select public.purge_expired_payment_data();$$
);
