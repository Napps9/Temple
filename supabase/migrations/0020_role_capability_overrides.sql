-- Owner-configurable role capabilities, enforced server-side.
--
-- Background: until now, src/lib/can.ts (client) and the 9 user_can_*
-- SQL helpers (server) held a hardcoded role → capability matrix.
-- Gyms could not change it. This migration introduces:
--
--   1. gym_role_capabilities — per-gym overrides keyed on (role, capability)
--   2. default_capability(role, capability) — the baked-in matrix mirror
--      of src/lib/can.ts (single source of SQL truth for defaults)
--   3. effective_can(gym_id, capability) — what RLS policies and RPCs
--      should call. Combines override + default for the caller's role.
--   4. effective_can_for_role(gym_id, role, capability) — same lookup
--      but for an arbitrary role, owner-only. Used by the Team screen
--      to render the permission matrix UI.
--
-- The owner role always has every capability (no override can revoke).
-- The member role never has staff-area capabilities. Both are short-
-- circuited inside effective_can() so they can never be locked out by
-- an admin overriding the wrong row.
--
-- Re-pointed in this migration to use effective_can():
--   - gym_insight_targets policies → can_set_targets / can_see_insights
--   - billing_events SELECT policy → can_see_money
--   - create_invite RPC → can_manage_staff
--   - compute_insight_summary RPC → can_see_insights
--   - compute_revenue_summary RPC → can_see_money
--
-- Other policies still calling the 9 helpers are left alone; they
-- migrate incrementally as features touch them.

-- ============================================================================
-- 1. gym_role_capabilities — sparse override table
-- ============================================================================

create table public.gym_role_capabilities (
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  role       public.gym_role not null check (role not in ('owner', 'member')),
  capability text not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (gym_id, role, capability)
);

alter table public.gym_role_capabilities enable row level security;

-- Owners see every row for their gym; non-owners only see overrides
-- for their own role (so useCan() can resolve them client-side).
create policy gym_role_capabilities_owner_select on public.gym_role_capabilities
  for select using (public.user_is_owner_of(gym_id));

create policy gym_role_capabilities_self_select on public.gym_role_capabilities
  for select using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id     = gym_role_capabilities.gym_id
        and gm.profile_id = auth.uid()
        and gm.role       = gym_role_capabilities.role
    )
  );

-- Owners only for CUD.
create policy gym_role_capabilities_owner_insert on public.gym_role_capabilities
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_role_capabilities_owner_update on public.gym_role_capabilities
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_role_capabilities_owner_delete on public.gym_role_capabilities
  for delete using (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 2. default_capability(role, capability) — mirrors src/lib/can.ts
-- ============================================================================
--
-- Owner and member roles are short-circuited in effective_can() and
-- never reach this function (owner = always true, member = always false).
-- Only admin / coach / staff have meaningful defaults.

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role in ('admin','coach','staff')
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 3. effective_can(gym_id, capability) — runtime gate for RLS + RPCs
-- ============================================================================

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
  v_role public.gym_role;
  v_override boolean;
begin
  select role into v_role
    from public.gym_memberships
    where gym_id = p_gym_id and profile_id = auth.uid();
  if v_role is null then
    return false;
  end if;
  -- Structural floors and ceilings — never overridable.
  if v_role = 'owner' then
    return true;
  end if;
  if v_role = 'member' then
    return false;
  end if;
  select enabled into v_override
    from public.gym_role_capabilities
    where gym_id     = p_gym_id
      and role       = v_role
      and capability = p_capability;
  if v_override is not null then
    return v_override;
  end if;
  return public.default_capability(v_role, p_capability);
end;
$$;

grant execute on function public.effective_can(uuid, text) to authenticated;

-- ============================================================================
-- 4. effective_can_for_role — owner-only inspector for the Team screen
-- ============================================================================

create or replace function public.effective_can_for_role(
  p_gym_id     uuid,
  p_role       public.gym_role,
  p_capability text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_override boolean;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if p_role = 'owner' then
    return true;
  end if;
  if p_role = 'member' then
    return false;
  end if;
  select enabled into v_override
    from public.gym_role_capabilities
    where gym_id     = p_gym_id
      and role       = p_role
      and capability = p_capability;
  if v_override is not null then
    return v_override;
  end if;
  return public.default_capability(p_role, p_capability);
end;
$$;

grant execute on function public.effective_can_for_role(uuid, public.gym_role, text) to authenticated;

-- ============================================================================
-- 5. Re-point policies that gate the new UI surface area
-- ============================================================================
--
-- gym_insight_targets:
--   SELECT — was user_can_admin; now effective_can(can_see_insights)
--   CUD    — was user_is_owner_of; now effective_can(can_set_targets)

drop policy if exists gym_insight_targets_admin_select on public.gym_insight_targets;
drop policy if exists gym_insight_targets_owner_insert on public.gym_insight_targets;
drop policy if exists gym_insight_targets_owner_update on public.gym_insight_targets;
drop policy if exists gym_insight_targets_owner_delete on public.gym_insight_targets;

create policy gym_insight_targets_select on public.gym_insight_targets
  for select using (public.effective_can(gym_id, 'can_see_insights'));
create policy gym_insight_targets_insert on public.gym_insight_targets
  for insert with check (public.effective_can(gym_id, 'can_set_targets'));
create policy gym_insight_targets_update on public.gym_insight_targets
  for update using (public.effective_can(gym_id, 'can_set_targets'))
  with check (public.effective_can(gym_id, 'can_set_targets'));
create policy gym_insight_targets_delete on public.gym_insight_targets
  for delete using (public.effective_can(gym_id, 'can_set_targets'));

-- billing_events:
--   staff SELECT — was user_can_assign_plan (owner+admin+coach+staff);
--   now effective_can(can_see_money) (owner-only by default,
--   per-gym configurable). Existing self-select policy unchanged.

drop policy if exists billing_events_staff_select on public.billing_events;

create policy billing_events_money_select on public.billing_events
  for select using (
    gym_id is not null
    and public.effective_can(gym_id, 'can_see_money')
  );

-- ============================================================================
-- 6. Re-point RPCs that gate the new UI surface area
-- ============================================================================

create or replace function public.create_invite(
  p_gym_id     uuid,
  p_role       public.gym_role,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text;
  v_is_owner  boolean;
begin
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;
  v_is_owner := public.user_is_owner_of(p_gym_id);
  -- Owner-only ladder for minting higher-privilege roles. Structural,
  -- not overridable: an admin must never be able to mint another admin
  -- or an owner, regardless of can_manage_staff overrides.
  if not v_is_owner and p_role in ('owner', 'admin') then
    raise exception 'Only owners can invite owners or admins';
  end if;
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.invite_codes (gym_id, code, role, created_by, expires_at)
    values (p_gym_id, v_code, p_role, auth.uid(), p_expires_at);
  return v_code;
end;
$$;

grant execute on function public.create_invite(uuid, public.gym_role, timestamptz) to authenticated;

-- compute_insight_summary: switch admin check to can_see_insights so
-- coaches/staff with the (now-default-on) capability can read it.

create or replace function public.compute_insight_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  intros_new         integer,
  intros_target      integer,
  conversions        integer,
  conversions_target integer,
  expiring_soon      integer,
  expired            integer,
  paying_now         integer,
  billing_live       boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_insights') then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;

  return query
  with cohort as (
    select * from public.v_member_cohort where gym_id = p_gym_id
  ),
  conv as (
    select count(distinct be.member_id) as n
    from public.billing_events be
    where be.gym_id = p_gym_id
      and be.kind in ('charge.succeeded', 'invoice.paid')
      and be.occurred_at::date between p_period_start and p_period_end
      and not exists (
        select 1 from public.billing_events be2
        where be2.gym_id = p_gym_id
          and be2.member_id = be.member_id
          and be2.kind in ('charge.succeeded', 'invoice.paid')
          and be2.occurred_at < be.occurred_at
      )
  ),
  targets as (
    select metric, target_value from public.gym_insight_targets
    where gym_id = p_gym_id
      and period = case
        when p_period_end - p_period_start <= 31 then 'month'
        else 'quarter'
      end
  )
  select
    (select count(*)::int from cohort
      where is_intro
        and joined_at::date between p_period_start and p_period_end),
    coalesce((select target_value from targets where metric = 'intros_new'), 0),
    (select coalesce(n, 0)::int from conv),
    coalesce((select target_value from targets where metric = 'conversions'), 0),
    (select count(*)::int from cohort where is_expiring_soon),
    (select count(*)::int from cohort where is_expired),
    (select count(*)::int from cohort where is_paying),
    exists(select 1 from public.billing_events where gym_id = p_gym_id);
end;
$$;

grant execute on function public.compute_insight_summary(uuid, date, date) to authenticated;

-- compute_revenue_summary: switch owner check to effective_can(can_see_money)
-- so an owner can grant revenue access to e.g. an admin.

create or replace function public.compute_revenue_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  currency     text,
  gross_cents  bigint,
  charge_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_money') then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;

  return query
  select
    be.currency,
    sum(be.amount_cents)::bigint as gross_cents,
    count(*)::int                as charge_count
  from public.billing_events be
  where be.gym_id = p_gym_id
    and public.is_revenue_event(be.provider, be.kind)
    and be.occurred_at::date between p_period_start and p_period_end
  group by be.currency;
end;
$$;

grant execute on function public.compute_revenue_summary(uuid, date, date) to authenticated;
