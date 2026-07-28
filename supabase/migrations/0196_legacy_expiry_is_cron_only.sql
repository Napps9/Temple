-- A fifth cron-only sweep was reachable with the publishable key.
--
-- 0192 revoked three retention sweeps (purge_expired_*) that anon and
-- authenticated could call directly. This is the same shape and the same
-- session's audit missed it because the name is expire_*, not purge_*:
-- expire_unbilled_legacy_subscriptions (0125) is security definer, has no
-- internal authorisation check, and lapses subscriptions across EVERY gym
-- in a single UPDATE. Its only legitimate caller is the daily pg_cron job
-- (registered in 0189). It is called nowhere in the client.
--
-- 0125 granted it to `authenticated` and never revoked the PUBLIC default
-- that CREATE FUNCTION hands out, so its real audience is anon too. A
-- caller with the publishable key can flip imported-legacy subscriptions
-- from 'active' to 'lapsed' on demand — bounded to rows already past
-- paid_period_end, but a real cross-tenant mutation that revokes those
-- members' booking eligibility ahead of the gym's own cadence.
--
-- The cron job runs as the scheduler, which is unaffected by this revoke.

begin;

revoke execute on function public.expire_unbilled_legacy_subscriptions()
  from public, anon, authenticated;

commit;
