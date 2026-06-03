-- Phase 0.4: comp_grants — bounded non-paying entitlements.
--
-- Free trials, foundation courses, ex-member tasters. Mirrors the
-- credit-pool shape of plan_subscriptions so the eligibility
-- predicate (§0.5) and the booking-time overspend lock have one
-- model across paid and non-paying sources.
--
-- The RPC pair (grant_comp, revoke_comp) that auto-creates the
-- gym_memberships relationship row and emits audit_events rows is
-- deferred — audit_events lands in Phase 4. Until then, staff
-- inserts go through the RLS-gated table directly, and the FK to
-- gym_memberships(gym_id, profile_id) makes orphan grants
-- impossible.

-- ============================================================================
-- 1. user_can_issue_comp_grant helper (Owner + Coach)
-- ============================================================================

create or replace function public.user_can_issue_comp_grant(target_gym_id uuid)
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
grant execute on function public.user_can_issue_comp_grant(uuid) to authenticated;

-- ============================================================================
-- 2. comp_grants table
-- ============================================================================

create table public.comp_grants (
  grant_id              uuid primary key default gen_random_uuid(),
  gym_id                uuid not null,
  profile_id            uuid not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  credits_total         integer,
  credits_remaining     integer,
  class_type_allowlist  uuid[] not null default '{}',
  granted_by            uuid not null references public.profiles(id),
  reason                text,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade,
  check (ends_at > starts_at),
  check (
    (credits_total is null and credits_remaining is null) or
    (credits_total is not null and credits_remaining is not null
     and credits_remaining between 0 and credits_total)
  )
);

create index comp_grants_gym_profile_idx on public.comp_grants(gym_id, profile_id);
create index comp_grants_window_idx      on public.comp_grants(starts_at, ends_at);

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.comp_grants enable row level security;

create policy comp_grants_self_select on public.comp_grants
  for select using (profile_id = auth.uid());

-- Staff (owner/coach/staff) can read all grants in their gym; reuses
-- user_can_assign_plan because the read scope is the same as plan
-- subscriptions: anyone in the member-admin / bookings team needs to
-- see attached entitlements.
create policy comp_grants_staff_select on public.comp_grants
  for select using (public.user_can_assign_plan(gym_id));

-- Issue: gated to Owner+Coach per the can_issue_comp_grant capability.
create policy comp_grants_owner_coach_insert on public.comp_grants
  for insert with check (public.user_can_issue_comp_grant(gym_id));

-- Revoke + credit adjustments: same gate. Plan §0.4 keeps grant
-- lifecycle (revoke / extend / adjust) inside the issuer tier.
create policy comp_grants_owner_coach_update on public.comp_grants
  for update using (public.user_can_issue_comp_grant(gym_id))
  with check (public.user_can_issue_comp_grant(gym_id));

-- No delete policy: grants are state-managed via revoked_at, not
-- deleted, except via cascade from gym_memberships on erasure
-- (§4.2).
