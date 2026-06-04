-- Temple: gyms, profiles, gym_memberships, invite_codes
-- All tenant-scoped tables enforce RLS keyed on gym_id.

-- pgcrypto provides gen_random_bytes (used by create_invite). Hosted
-- Supabase preinstalls it in the extensions schema, but we declare it
-- explicitly so a clean local database / CI runner has it too. gen_random_uuid
-- (used in defaults below) is in pg17+ core and does not require pgcrypto.
create extension if not exists pgcrypto with schema extensions;

create table public.gyms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  avatar_url text,
  phone      text,
  created_at timestamptz not null default now()
);

create type public.gym_role as enum ('owner', 'coach', 'staff', 'member');

create table public.gym_memberships (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.gym_role not null,
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (gym_id, profile_id)
);

create index gym_memberships_profile_id_idx on public.gym_memberships(profile_id);
create index gym_memberships_gym_id_idx on public.gym_memberships(gym_id);

create table public.invite_codes (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  code       text not null unique,
  role       public.gym_role not null default 'member',
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  used_by    uuid references public.profiles(id),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index invite_codes_gym_id_idx on public.invite_codes(gym_id);
create index invite_codes_code_idx on public.invite_codes(code);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.gyms enable row level security;
alter table public.profiles enable row level security;
alter table public.gym_memberships enable row level security;
alter table public.invite_codes enable row level security;

create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy gyms_member_select on public.gyms
  for select using (
    id in (
      select gym_id from public.gym_memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

create policy gym_memberships_tenant_select on public.gym_memberships
  for select using (
    gym_id in (
      select gym_id from public.gym_memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

create policy gym_memberships_owner_update on public.gym_memberships
  for update using (
    gym_id in (
      select gym_id from public.gym_memberships
      where profile_id = auth.uid() and role = 'owner' and status = 'active'
    )
  );

create policy invite_codes_tenant_select on public.invite_codes
  for select using (
    gym_id in (
      select gym_id from public.gym_memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

create policy invite_codes_owner_insert on public.invite_codes
  for insert with check (
    gym_id in (
      select gym_id from public.gym_memberships
      where profile_id = auth.uid() and role = 'owner' and status = 'active'
    )
  );

-- ============================================================================
-- accept_invite RPC
-- ============================================================================

create or replace function public.accept_invite(invite_code text)
returns table (gym_id uuid, role public.gym_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes;
  v_profile uuid;
begin
  v_profile := auth.uid();
  if v_profile is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite from public.invite_codes where code = invite_code;
  if v_invite is null then
    raise exception 'Invite code not found';
  end if;
  if v_invite.used_at is not null then
    raise exception 'Invite code already used';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite code expired';
  end if;

  insert into public.gym_memberships (gym_id, profile_id, role, status)
  values (v_invite.gym_id, v_profile, v_invite.role, 'active')
  on conflict (gym_id, profile_id) do update
    set role = excluded.role, status = 'active';

  update public.invite_codes
  set used_by = v_profile, used_at = now()
  where id = v_invite.id;

  return query select v_invite.gym_id, v_invite.role;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
