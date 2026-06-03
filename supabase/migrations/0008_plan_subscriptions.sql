-- Phase 0.2 + 0.3: entitlement state machine + grain split.
--
-- Splits per-plan state out of gym_memberships into many
-- plan_subscriptions per relationship row. Adds membership_plans
-- catalog + plan_class_types allowlist. gym_memberships keeps its
-- name and primary key but loses the status column (state lives on
-- plan_subscriptions now); gains health_flag, emergency_contact,
-- par_q_id (FK to health_screenings is deferred to Phase 4 when the
-- target table lands). RLS helpers are updated so they no longer
-- filter on gym_memberships.status.
--
-- See docs/entitlement-states.md for the plan_subscriptions state
-- machine and side-state semantics.

-- ============================================================================
-- 1. plan_subscriptions state machine
-- ============================================================================

create type public.plan_sub_state as enum (
  'pending',
  'active',
  'paused',
  'cancelled_at_period_end',
  'lapsed',
  'cancelled',
  'refunded_retained'
);

-- ============================================================================
-- 2. New helper: user_can_assign_plan (Owner + Coach + Staff)
--    Defined before plan_subscriptions RLS references it.
-- ============================================================================

create or replace function public.user_can_assign_plan(target_gym_id uuid)
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
      and role in ('owner', 'coach', 'staff')
  );
$$;
grant execute on function public.user_can_assign_plan(uuid) to authenticated;

-- ============================================================================
-- 3. membership_plans (per-gym catalog)
-- ============================================================================

create table public.membership_plans (
  plan_id             uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  name                text not null,
  kind                text not null check (kind in ('unlimited', 'credit_period', 'credit_pack')),
  credit_count        integer,
  period_length       interval,
  monthly_price_cents integer,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (
    (kind = 'unlimited'    and credit_count is null     and period_length is null) or
    (kind = 'credit_period' and credit_count is not null and period_length is not null) or
    (kind = 'credit_pack'   and credit_count is not null and period_length is null)
  )
);

create index membership_plans_gym_id_idx on public.membership_plans(gym_id);

alter table public.membership_plans enable row level security;

create policy membership_plans_tenant_select on public.membership_plans
  for select using (public.user_belongs_to(gym_id));
create policy membership_plans_owner_insert on public.membership_plans
  for insert with check (public.user_is_owner_of(gym_id));
create policy membership_plans_owner_update on public.membership_plans
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy membership_plans_owner_delete on public.membership_plans
  for delete using (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 4. plan_class_types (allowlist; empty = all class types)
-- ============================================================================

create table public.plan_class_types (
  plan_id       uuid not null references public.membership_plans(plan_id) on delete cascade,
  class_type_id uuid not null references public.class_types(id) on delete cascade,
  primary key (plan_id, class_type_id)
);

alter table public.plan_class_types enable row level security;

create policy plan_class_types_tenant_select on public.plan_class_types
  for select using (
    exists (
      select 1 from public.membership_plans mp
      where mp.plan_id = plan_class_types.plan_id
        and public.user_belongs_to(mp.gym_id)
    )
  );
create policy plan_class_types_owner_insert on public.plan_class_types
  for insert with check (
    exists (
      select 1 from public.membership_plans mp
      where mp.plan_id = plan_class_types.plan_id
        and public.user_is_owner_of(mp.gym_id)
    )
  );
create policy plan_class_types_owner_delete on public.plan_class_types
  for delete using (
    exists (
      select 1 from public.membership_plans mp
      where mp.plan_id = plan_class_types.plan_id
        and public.user_is_owner_of(mp.gym_id)
    )
  );

-- ============================================================================
-- 5. plan_subscriptions (many per gym_memberships row)
-- ============================================================================

create table public.plan_subscriptions (
  id                              uuid primary key default gen_random_uuid(),
  gym_membership_id               uuid not null references public.gym_memberships(id) on delete cascade,
  profile_id                      uuid not null references public.profiles(id) on delete cascade,
  gym_id                          uuid not null references public.gyms(id) on delete cascade,
  plan_id                         uuid not null references public.membership_plans(plan_id),
  status                          public.plan_sub_state not null,
  credit_balance                  integer,
  period_resets_at                timestamptz,
  paid_period_end                 timestamptz,
  stripe_subscription_id          text,
  awaiting_payment_authentication boolean not null default false,
  cancelled_at                    timestamptz,
  created_at                      timestamptz not null default now()
);

create index plan_subscriptions_gym_membership_idx
  on public.plan_subscriptions(gym_membership_id);
create index plan_subscriptions_gym_profile_idx
  on public.plan_subscriptions(gym_id, profile_id);
create index plan_subscriptions_status_idx
  on public.plan_subscriptions(status);

-- Trigger: denormalised (profile_id, gym_id) must match the parent
-- gym_memberships row. Fires only when those columns or the FK
-- change.
create or replace function public.plan_subscriptions_match_parent()
returns trigger
language plpgsql
as $$
declare
  v_parent_profile_id uuid;
  v_parent_gym_id     uuid;
begin
  select profile_id, gym_id
    into v_parent_profile_id, v_parent_gym_id
  from public.gym_memberships
  where id = new.gym_membership_id;
  if v_parent_profile_id is null then
    raise exception 'plan_subscriptions.gym_membership_id % does not resolve to a gym_memberships row',
      new.gym_membership_id;
  end if;
  if v_parent_profile_id <> new.profile_id then
    raise exception 'plan_subscriptions.profile_id (%) does not match parent gym_memberships.profile_id (%)',
      new.profile_id, v_parent_profile_id;
  end if;
  if v_parent_gym_id <> new.gym_id then
    raise exception 'plan_subscriptions.gym_id (%) does not match parent gym_memberships.gym_id (%)',
      new.gym_id, v_parent_gym_id;
  end if;
  return new;
end;
$$;

create trigger plan_subscriptions_match_parent_trg
before insert or update of gym_membership_id, profile_id, gym_id
on public.plan_subscriptions
for each row execute function public.plan_subscriptions_match_parent();

alter table public.plan_subscriptions enable row level security;

create policy plan_subscriptions_self_select on public.plan_subscriptions
  for select using (profile_id = auth.uid());
create policy plan_subscriptions_staff_select on public.plan_subscriptions
  for select using (public.user_can_assign_plan(gym_id));
create policy plan_subscriptions_staff_insert on public.plan_subscriptions
  for insert with check (public.user_can_assign_plan(gym_id));
create policy plan_subscriptions_staff_update on public.plan_subscriptions
  for update using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));
-- No delete policy: plan_subscriptions are state-managed
-- (cancelled / lapsed), not deleted, except via cascade from
-- gym_memberships on erasure (§4.2).

-- ============================================================================
-- 6. Recreate existing helpers without the status filter.
--    Done before dropping the column so no function body references
--    a missing column at any point.
-- ============================================================================

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
  );
$$;

create or replace function public.user_can_manage_classes(target_gym_id uuid)
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
      and role in ('owner', 'coach')
  );
$$;

create or replace function public.same_gym_as_caller(target_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.gym_memberships gm1
    join public.gym_memberships gm2 on gm1.gym_id = gm2.gym_id
    where gm1.profile_id = auth.uid()
      and gm2.profile_id = target_profile
  );
$$;

-- ============================================================================
-- 7. accept_invite: stop writing status (column is about to disappear)
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

  insert into public.gym_memberships (gym_id, profile_id, role)
  values (v_invite.gym_id, v_profile, v_invite.role)
  on conflict (gym_id, profile_id) do update
    set role = excluded.role;

  update public.invite_codes
  set used_by = v_profile, used_at = now()
  where id = v_invite.id;

  return query select v_invite.gym_id, v_invite.role;
end;
$$;

-- ============================================================================
-- 8. gym_memberships: drop status, add health columns.
--    Safe to drop now: no remaining function body or policy
--    references gym_memberships.status.
-- ============================================================================

alter table public.gym_memberships
  drop column status;

alter table public.gym_memberships
  add column health_flag       boolean not null default false,
  add column emergency_contact text,
  add column par_q_id          uuid;
-- par_q_id FK to public.health_screenings is added in Phase 4 once
-- that table exists (plan §4.1).
