-- Three retention sweeps are callable by anyone, including anon.
--
-- Six purge_* functions run on pg_cron. The three most recent
-- (purge_expired_leads 0114, purge_expired_agent_recordings 0137,
-- purge_expired_agent_conversations 0143) revoke execute from public,
-- anon and authenticated, because a security-definer function whose whole
-- body is DELETE has no business being reachable from a browser. The
-- three older ones — 0037/0049 health, 0108 waiver signatures, 0176
-- payment — instead say `grant execute … to authenticated`, and since
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default and no later
-- create-or-replace resets an ACL, their real grant is PUBLIC: anon can
-- call them with the project's publishable key, which is in the client
-- bundle.
--
-- What that gets an attacker is a destructive sweep on demand, across
-- every gym on the platform at once:
--
--   purge_expired_health_data          erases Article 9 health records for
--                                      every departed member past their
--                                      gym's retention window, via
--                                      _erase_member_health_data
--   purge_expired_waiver_signatures    deletes the liability records that
--                                      are deliberately kept OUT of the
--                                      erasure sweep, because the lawful
--                                      basis for holding them is defence
--                                      of legal claims
--   purge_expired_payment_data         deletes invoice links and a year of
--                                      payment notifications
--
-- Each only removes rows already past retention, so this is early, not
-- extra — the same rows would go within 24 hours anyway. That is what
-- keeps it out of the critical band, and it is not a reason to leave it:
-- the erasure is irreversible, it is attributed to 'purge' in
-- health_data_access_log so an on-demand call is indistinguishable from
-- the nightly one, and repeat calls are a free full-table scan and delete
-- for an unauthenticated caller.
--
-- No client calls any of the three. purge_expired_health_data has an entry
-- in the hand-maintained database.ts Functions map, which is the only
-- trace of the original intent; it is removed alongside this.

begin;

revoke execute on function public.purge_expired_health_data()
  from public, anon, authenticated;

revoke execute on function public.purge_expired_waiver_signatures()
  from public, anon, authenticated;

revoke execute on function public.purge_expired_payment_data()
  from public, anon, authenticated;

commit;
