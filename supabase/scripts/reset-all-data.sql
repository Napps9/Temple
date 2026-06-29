-- DANGER: full tenant-data wipe. Deletes every account, gym, and all
-- gym-scoped data so you can run the signup/onboarding flows from a
-- clean slate. This is irreversible and is meant for a test/staging
-- project, not a live one with real customers.
--
-- What it does:
--   1. TRUNCATE every base table in the `public` schema (CASCADE), which
--      clears both data roots -- gyms and profiles -- plus everything
--      that FK-cascades from them. Done dynamically so it stays correct
--      as new tables are added.
--   2. DELETE every auth.users row. profiles.id references auth.users
--      ON DELETE CASCADE, but profiles is truncated above, so this just
--      clears the auth side (identities/sessions cascade within auth).
--
-- What it does NOT touch:
--   - Schema, RPCs, the capability-default function, RLS policies.
--   - Storage objects (avatars, gym logos, waiver PDFs). Those become
--     orphaned but harmless; clear them separately if you want
--     (see the commented block at the bottom).
--
-- Run as a privileged role (Supabase SQL editor, or
-- `supabase db execute --file supabase/scripts/reset-all-data.sql`).
-- TRUNCATE bypasses RLS, so a normal authenticated session can't run it.

begin;

do $$
declare
  v_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into v_tables
  from pg_tables
  where schemaname = 'public';

  if v_tables is not null then
    execute 'truncate table ' || v_tables || ' restart identity cascade';
  end if;
end;
$$;

delete from auth.users;

commit;

-- Optional: also wipe Storage objects (uncomment to run). Buckets
-- themselves are preserved; only the files are removed.
--
-- delete from storage.objects;
