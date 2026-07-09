-- 0112_schedule_security_monitor.sql
--
-- Schedule run_security_monitor() (0111) via pg_cron, and enable pg_net so
-- the monitor can optionally POST to the security-alert edge function. pg_net
-- is Supabase-supported but not previously enabled here. cron.schedule upserts
-- by job name, so re-running replaces the job.

create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'security-monitor',
  '*/15 * * * *', -- every 15 minutes
  $$select public.run_security_monitor();$$
);
