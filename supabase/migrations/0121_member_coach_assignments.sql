-- Retention cockpit, Phase 1d — member -> owning coach.
--
-- Leads already have an assigned_coach_id (0114), but members do not: there's
-- no concept of "whose member is this". The cockpit's in-app nudges need a
-- target, and a coach wants a "my at-risk members" view, so this adds an
-- explicit, one-coach-per-member assignment plus the setter RPC.
--
-- One row per (gym_id, member_id). Writes go only through
-- assign_member_coach (no client write policy); reads are gated on
-- can_see_retention so the cockpit can show the assignee.

begin;

create table public.member_coach_assignments (
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  member_id   uuid not null references public.profiles(id) on delete cascade,
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (gym_id, member_id)
);

create index member_coach_assignments_coach_idx
  on public.member_coach_assignments(gym_id, coach_id);

alter table public.member_coach_assignments enable row level security;

-- Read for retention-capable staff; no client insert/update/delete (the RPC
-- under security definer is the only write path).
create policy member_coach_assignments_tenant_select on public.member_coach_assignments
  for select using (public.effective_can(gym_id, 'can_see_retention'));

-- assign_member_coach — set or clear a member's owning coach. Passing a null
-- coach clears the assignment. Cross-tenant guards on both the member and the
-- coach (the set_lead_assignee pattern, 0114).
create or replace function public.assign_member_coach(
  p_gym_id    uuid,
  p_member_id uuid,
  p_coach_id  uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_see_retention') then
    raise exception 'Not authorised';
  end if;
  -- The member must belong to this gym.
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_member_id and role = 'member'
  ) then
    raise exception 'Member is not part of this gym';
  end if;

  if p_coach_id is null then
    delete from public.member_coach_assignments
      where gym_id = p_gym_id and member_id = p_member_id;
    return;
  end if;

  -- The coach must be current staff of this gym.
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_coach_id
      and role in ('owner', 'admin', 'coach', 'staff') and left_at is null
  ) then
    raise exception 'Coach is not a staff member of this gym';
  end if;

  insert into public.member_coach_assignments
    (gym_id, member_id, coach_id, assigned_at, assigned_by)
  values (p_gym_id, p_member_id, p_coach_id, now(), auth.uid())
  on conflict (gym_id, member_id) do update
    set coach_id = excluded.coach_id,
        assigned_at = now(),
        assigned_by = auth.uid();
end;
$$;
grant execute on function public.assign_member_coach(uuid, uuid, uuid) to authenticated;

commit;
