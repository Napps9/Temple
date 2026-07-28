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
-- purge_* or dispatch_* someone adds fails here if it ships open.

begin;
select plan(2);

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

select * from finish();
rollback;
