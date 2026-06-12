-- Auto-create a public.profiles row when a new auth.users row is
-- created, so the signup flow doesn't depend on the client doing an
-- RLS-gated INSERT immediately after auth.signUp.
--
-- The bug: auth.signUp returns { user, session } where `session` can
-- be null (email confirmation enabled, transient client state, etc.).
-- The follow-up `.from('profiles').insert(...)` then runs with the
-- anon JWT, so auth.uid() is null and the policy
-- `profiles_self_insert (id = auth.uid())` rejects it — surfaced to
-- members as "new row violates row-level security policy for table
-- 'profiles'" right after typing their password.
--
-- The trigger is the standard Supabase pattern: the profile row is
-- created server-side the moment the auth user is, using the
-- `full_name` we pass through `signUp({ options: { data } })` (lands
-- in `auth.users.raw_user_meta_data`). The client stops writing to
-- `profiles` entirely. Backfills any pre-existing auth users that
-- don't already have a profiles row, so the first-deploy moment
-- doesn't leave orphans.

begin;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill: any pre-existing auth user without a profile gets one now,
-- using the full_name from their metadata if present (else null, which
-- the account screen lets them set later).
insert into public.profiles (id, full_name)
select
  u.id,
  nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

commit;
