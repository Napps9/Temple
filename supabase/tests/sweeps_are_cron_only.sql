-- Invariant: nothing whose body is a DELETE is reachable from a browser.
--
-- Every scheduled sweep runs as the table owner under pg_cron and needs no
-- grant at all. Three of them (0037/0049, 0108, 0176) instead carried
-- `grant execute … to authenticated`, and because CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default and create-or-replace preserves an ACL,
-- their real audience was anon — a destructive retention sweep across
-- every gym on the platform, on demand, with the publishable key.
--
-- Asserted as a family rather than one function at a time, so the next
-- purge_* or dispatch_* someone adds fails here if it ships open. The
-- family is keyed on name, which is exactly how expire_unbilled_legacy_
-- subscriptions slipped the first pass (0196) — it is a cron-only
-- cross-tenant sweep named expire_*, not purge_*. expire_* is in the
-- family now; both members are cron sweeps and neither is client-called.

begin;
select plan(5);

\ir _helpers.psql

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'purge\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'no retention purge is callable by anon or authenticated'
);

-- The dispatchers are not destructive, but they spend money: each one
-- POSTs to a worker that mails real people, and each carries the service
-- role key out of Vault to do it.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'dispatch\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'nor is any worker dispatcher'
);

-- expire_* is the same cross-tenant sweep shape under a different verb.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'expire\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'nor any expire_* sweep'
);

-- The jobs' ticks are the same shape again: cross-tenant, cron-only, and
-- the most consequential of the lot — a tick proposes and, at
-- `autonomous`, executes, which queues real email to real members. Four of
-- them now (revenue, retention, cover, first week) and they were correctly
-- revoked one at a time by hand, which is exactly the arrangement this
-- file exists to stop relying on: create-or-replace preserves an ACL and
-- CREATE FUNCTION grants PUBLIC by default, so the next person to reshape
-- one of these has to remember. Keyed on the name so the fifth job is
-- covered without editing this test.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'agent\_%\_tick'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'nor any job tick'
);

-- And the two definer helpers the ticks call. _agent_execute_action is the
-- single path by which an approved action becomes a queued message, and it
-- takes an action id — reachable from a client it would let anybody send
-- any gym's pending note by guessing a uuid.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '\_agent\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'nor the helpers a tick executes through'
);

select * from finish();
rollback;
