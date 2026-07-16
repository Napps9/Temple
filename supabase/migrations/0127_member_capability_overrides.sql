-- 0127_member_capability_overrides.sql
--
-- Per-member capability overrides. gym_role_capabilities (0020) sets
-- capabilities per ROLE — so every coach at a gym is identical. This adds a
-- per-PERSON layer on top, so an owner can give Ed (full-time coach) revenue
-- + refunds while Charlotte (part-time coach) only gets programming.
--
-- Precedence in effective_can becomes:
--   owner              → always yes
--   member             → always no
--   otherwise          → member override ?? role override ?? role default
--
-- CUD is owner-only (same as role overrides) so an admin can't escalate
-- their own — or anyone's — permissions.

create table public.gym_member_capabilities (
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  capability text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (gym_id, profile_id, capability)
);

create index gym_member_capabilities_profile_idx
  on public.gym_member_capabilities(gym_id, profile_id);

alter table public.gym_member_capabilities enable row level security;

-- Owners see every row for their gym (to run the editor); a member sees
-- their own (so useCan can resolve them client-side).
create policy gym_member_capabilities_owner_select on public.gym_member_capabilities
  for select using (public.user_is_owner_of(gym_id));

create policy gym_member_capabilities_self_select on public.gym_member_capabilities
  for select using (profile_id = auth.uid());

-- Owner-only for CUD.
create policy gym_member_capabilities_owner_insert on public.gym_member_capabilities
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_member_capabilities_owner_update on public.gym_member_capabilities
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_member_capabilities_owner_delete on public.gym_member_capabilities
  for delete using (public.user_is_owner_of(gym_id));

-- effective_can: slot the per-member override in above the per-role override.
-- Same (uuid, text) -> boolean shape, so CREATE OR REPLACE is safe.
create or replace function public.effective_can(
  p_gym_id uuid,
  p_capability text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role            public.gym_role;
  v_member_override boolean;
  v_role_override   boolean;
begin
  select role into v_role
    from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = auth.uid()
      and left_at is null;
  if v_role is null then
    return false;
  end if;
  if v_role = 'owner' then
    return true;
  end if;
  if v_role = 'member' then
    return false;
  end if;

  -- Per-person override wins.
  select enabled into v_member_override
    from public.gym_member_capabilities
    where gym_id = p_gym_id
      and profile_id = auth.uid()
      and capability = p_capability;
  if v_member_override is not null then
    return v_member_override;
  end if;

  -- Then the per-role override.
  select enabled into v_role_override
    from public.gym_role_capabilities
    where gym_id = p_gym_id
      and role = v_role
      and capability = p_capability;
  if v_role_override is not null then
    return v_role_override;
  end if;

  return public.default_capability(v_role, p_capability);
end;
$$;
