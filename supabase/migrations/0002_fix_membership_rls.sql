-- Fix recursive RLS on gym_memberships.
--
-- The original tenant_isolation policies queried gym_memberships from
-- within a gym_memberships USING clause, which causes the row-reading
-- query to deadlock against its own policy. A user could authenticate but
-- the client-side membership fetch returned no rows, so the role-routing
-- never triggered.
--
-- Fix: SECURITY DEFINER helpers `user_belongs_to` and `user_is_owner_of`
-- check membership without re-entering gym_memberships RLS. The
-- gym_memberships table gets a simple self-select policy, plus an
-- owner-can-see-all policy via the helper.

drop policy if exists gym_memberships_tenant_select on public.gym_memberships;
drop policy if exists gym_memberships_owner_update  on public.gym_memberships;
drop policy if exists invite_codes_tenant_select    on public.invite_codes;
drop policy if exists invite_codes_owner_insert     on public.invite_codes;
drop policy if exists gyms_member_select            on public.gyms;

create or replace function public.user_belongs_to(target_gym_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.user_is_owner_of(target_gym_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  );
$$;

grant execute on function public.user_belongs_to(uuid) to authenticated;
grant execute on function public.user_is_owner_of(uuid) to authenticated;

create policy gym_memberships_self_select on public.gym_memberships
  for select using (profile_id = auth.uid());

create policy gym_memberships_owner_select on public.gym_memberships
  for select using (public.user_is_owner_of(gym_id));

create policy gym_memberships_owner_update on public.gym_memberships
  for update using (public.user_is_owner_of(gym_id));

create policy gyms_member_select on public.gyms
  for select using (public.user_belongs_to(id));

create policy invite_codes_tenant_select on public.invite_codes
  for select using (public.user_belongs_to(gym_id));

create policy invite_codes_owner_insert on public.invite_codes
  for insert with check (public.user_is_owner_of(gym_id));
