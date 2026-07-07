-- purge_expired_health_data() has existed since 0037/0049 but nothing ever
-- called it — the retention promise in docs/feature-inventory.md ("swept
-- for members who left more than 3 months ago") only held if an admin
-- happened to invoke the RPC by hand. This closes the engineering half of
-- that gap by scheduling it via pg_cron, which Supabase preloads on every
-- hosted project (no dashboard step needed, same enable-via-migration
-- pattern already used for pgcrypto in 0001 and pg_trgm in 0076).
--
-- The remaining GDPR roadmap items (lawful-basis sign-off, DPIA, the
-- consent-text legal copy) are policy work, not engineering, and aren't
-- touched here.

create extension if not exists pg_cron with schema pg_catalog;

-- cron.schedule upserts by job name, so re-running this migration (or a
-- future migration adjusting the schedule) replaces the existing job
-- rather than erroring or duplicating it.
select cron.schedule(
  'purge-expired-health-data',
  '0 3 * * *', -- daily at 03:00 UTC, off-peak for every timezone Temple serves
  $$select public.purge_expired_health_data();$$
);
