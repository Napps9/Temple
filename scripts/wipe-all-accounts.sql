-- Removes every account and all account-owned data from the platform.
--
-- THIS IS NOT A MIGRATION. It must never live in supabase/migrations/ --
-- migrations replay on every deploy, so a wipe placed there would empty
-- the database again on each push, forever. Run it by hand, once.
--
-- Run as the postgres/service role (Supabase dashboard -> SQL Editor),
-- which bypasses RLS. The anon and authenticated roles cannot do this.
--
-- Scope: this empties the public schema entirely, not just profiles.
-- 31 foreign keys point at profiles(id) with no ON DELETE rule (e.g.
-- class_programming.author_id, billing_events.member_id, invite_codes
-- .created_by), so Postgres RESTRICTs a bare `delete from auth.users`
-- and the statement fails. Gyms are also unrecoverable without owners.
-- So the only coherent reading of "remove all accounts" is a full reset.
--
-- Take a backup first: Supabase dashboard -> Database -> Backups.
-- There is no undo.

begin;

-- Enumerated from the catalog rather than hand-listed, so tables added
-- after this script was written are still covered. CASCADE settles the
-- FK ordering; RESTART IDENTITY resets sequences.
do $$
declare
  stmt text;
begin
  select 'truncate table '
         || string_agg(format('%I.%I', schemaname, tablename), ', ')
         || ' restart identity cascade'
    into stmt
    from pg_tables
   where schemaname = 'public';

  if stmt is null then
    raise notice 'no public tables found; nothing truncated';
  else
    execute stmt;
  end if;
end $$;

-- Storage is deliberately NOT touched here: Supabase's
-- storage.protect_delete() trigger refuses direct DML on storage tables
-- from SQL (dashboard editor included) — "Use the Storage API instead".
-- Empty the buckets from the dashboard's Storage page: avatars,
-- agent-call-recordings, agent-voice-samples, email-assets, gym-logos,
-- gym-waivers, member-programming-files, store-digital-assets,
-- store-product-images. Orphaned files are unreachable by any fresh
-- account either way, so this can also wait.

-- Last, because profiles.id references auth.users(id) on delete cascade
-- and the public schema is already empty by this point. This also
-- cascades to auth.sessions, auth.identities and auth.refresh_tokens.
delete from auth.users;

commit;
