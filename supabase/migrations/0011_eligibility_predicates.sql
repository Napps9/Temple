-- Phase 0.5 + 0.6: eligibility predicate + single-sourced default
-- picker, plus the two derived-status predicates.
--
-- select_default_entitlement is the single source of truth for which
-- entitlement gets consumed (§2.2): book_class calls it directly to
-- fire silently, and the post-hoc change-attribution flow calls it
-- to recompute and to render the "Booked via [label]" success state.
--
-- is_booking_eligible and list_booking_entitlements re-derive
-- eligibility from the same per-candidate rules to avoid drift.
--
-- is_active_relationship (broad) and has_ever_paid (strict, reads
-- billing_events) answer the cohort questions Operators care about.
--
-- paused-state eligibility for v1: denied. The plan flags "paused"
-- with two viable interpretations (pre-paid time held → eligible,
-- frozen → ineligible). docs/entitlement-states.md commits v1 to
-- ineligible; flip in a later migration if discovery says otherwise.

-- ============================================================================
-- 1. entitlement_kind enum (return type for the picker)
-- ============================================================================

create type public.entitlement_kind as enum ('comp_grant', 'plan_subscription');

-- ============================================================================
-- 2. select_default_entitlement — the picker, single source of truth
-- ============================================================================

create or replace function public.select_default_entitlement(
  p_profile_id       uuid,
  p_gym_id           uuid,
  p_class_session_id uuid
) returns table (kind public.entitlement_kind, id uuid)
language sql
security definer
stable
set search_path = public
as $$
  -- Authorisation: caller must be the target user or staff at the gym.
  -- A SQL function can't conditionally raise; we filter to no rows if
  -- unauthorised, mirroring the "no candidates" outcome. Staff-side
  -- callers are expected to use list_booking_entitlements anyway,
  -- which raises explicitly.
  with auth_ok as (
    select 1
    where p_profile_id = auth.uid()
       or public.user_can_assign_plan(p_gym_id)
  ),
  cs as (
    select cs.id, cs.gym_id, cs.class_type_id, cs.starts_at
    from public.class_sessions cs, auth_ok
    where cs.id = p_class_session_id and cs.gym_id = p_gym_id
  ),
  -- Bucket 1: eligible comp grants, earliest ends_at first
  eligible_comps as (
    select cg.grant_id, cg.ends_at
    from public.comp_grants cg, cs
    where cg.profile_id = p_profile_id
      and cg.gym_id = p_gym_id
      and cs.starts_at >= cg.starts_at
      and cs.starts_at <  cg.ends_at
      and cg.revoked_at is null
      and (cg.credits_total is null or cg.credits_remaining > 0)
      and (
        cardinality(cg.class_type_allowlist) = 0
        or cs.class_type_id = any(cg.class_type_allowlist)
      )
  ),
  comp_pick as (
    select grant_id from eligible_comps order by ends_at asc limit 1
  ),
  -- Eligible plan subscriptions (joined for kind / allowlist checks)
  eligible_plans as (
    select ps.id, mp.kind as plan_kind, ps.paid_period_end
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    cross join cs
    where ps.profile_id = p_profile_id
      and ps.gym_id     = p_gym_id
      and (
        ps.status = 'active'
        or (ps.status = 'cancelled_at_period_end'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
        or (ps.status = 'refunded_retained'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
      )
      and (
        mp.kind = 'unlimited'
        or coalesce(ps.credit_balance, 0) > 0
      )
      and (
        not exists (
          select 1 from public.plan_class_types pct where pct.plan_id = ps.plan_id
        )
        or exists (
          select 1 from public.plan_class_types pct
          where pct.plan_id = ps.plan_id and pct.class_type_id = cs.class_type_id
        )
      )
  ),
  -- Bucket 2: credit-based eligible plans, earliest paid_period_end
  --           (nulls last — credit_pack with no period sorts to the
  --           end of the credit-based group; still ahead of unlimited).
  credit_pick as (
    select id from eligible_plans
    where plan_kind in ('credit_period', 'credit_pack')
    order by paid_period_end asc nulls last
    limit 1
  ),
  -- Bucket 3: unlimited eligible plans
  unlimited_pick as (
    select id from eligible_plans where plan_kind = 'unlimited' limit 1
  )
  select 'comp_grant'::public.entitlement_kind, grant_id from comp_pick
  union all
  select 'plan_subscription'::public.entitlement_kind, id from credit_pick
    where not exists (select 1 from comp_pick)
  union all
  select 'plan_subscription'::public.entitlement_kind, id from unlimited_pick
    where not exists (select 1 from comp_pick)
      and not exists (select 1 from credit_pick)
  limit 1;
$$;
grant execute on function public.select_default_entitlement(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- 3. is_booking_eligible — disjunction over the same candidate rules
-- ============================================================================

create or replace function public.is_booking_eligible(
  p_profile_id       uuid,
  p_gym_id           uuid,
  p_class_session_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with auth_ok as (
    select 1
    where p_profile_id = auth.uid()
       or public.user_can_assign_plan(p_gym_id)
  )
  select coalesce(
    (
      select
        exists (
          select 1
          from public.comp_grants cg
          join public.class_sessions cs on cs.id = p_class_session_id and cs.gym_id = p_gym_id
          where cg.profile_id = p_profile_id
            and cg.gym_id     = p_gym_id
            and cs.starts_at >= cg.starts_at
            and cs.starts_at <  cg.ends_at
            and cg.revoked_at is null
            and (cg.credits_total is null or cg.credits_remaining > 0)
            and (
              cardinality(cg.class_type_allowlist) = 0
              or cs.class_type_id = any(cg.class_type_allowlist)
            )
        )
        or exists (
          select 1
          from public.plan_subscriptions ps
          join public.membership_plans mp on mp.plan_id = ps.plan_id
          join public.class_sessions cs on cs.id = p_class_session_id and cs.gym_id = p_gym_id
          where ps.profile_id = p_profile_id
            and ps.gym_id     = p_gym_id
            and (
              ps.status = 'active'
              or (ps.status = 'cancelled_at_period_end'
                  and ps.paid_period_end is not null
                  and cs.starts_at <= ps.paid_period_end)
              or (ps.status = 'refunded_retained'
                  and ps.paid_period_end is not null
                  and cs.starts_at <= ps.paid_period_end)
            )
            and (
              mp.kind = 'unlimited'
              or coalesce(ps.credit_balance, 0) > 0
            )
            and (
              not exists (
                select 1 from public.plan_class_types pct where pct.plan_id = ps.plan_id
              )
              or exists (
                select 1 from public.plan_class_types pct
                where pct.plan_id = ps.plan_id and pct.class_type_id = cs.class_type_id
              )
            )
        )
      from auth_ok
    ),
    false
  );
$$;
grant execute on function public.is_booking_eligible(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- 4. list_booking_entitlements — all eligible candidates with is_default
-- ============================================================================

create or replace function public.list_booking_entitlements(
  p_class_session_id   uuid,
  p_target_profile_id  uuid default null
) returns table (
  kind       public.entitlement_kind,
  id         uuid,
  is_default boolean,
  label      text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_profile      uuid;
  v_gym          uuid;
  v_default_kind public.entitlement_kind;
  v_default_id   uuid;
begin
  v_profile := coalesce(p_target_profile_id, auth.uid());
  if v_profile is null then
    return;
  end if;

  select gym_id into v_gym from public.class_sessions where id = p_class_session_id;
  if v_gym is null then
    return;
  end if;

  if v_profile <> auth.uid() and not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised to view another member''s entitlements';
  end if;

  select s.kind, s.id into v_default_kind, v_default_id
  from public.select_default_entitlement(v_profile, v_gym, p_class_session_id) s;

  return query
    select
      'comp_grant'::public.entitlement_kind,
      cg.grant_id,
      (v_default_kind = 'comp_grant' and cg.grant_id = v_default_id),
      coalesce(cg.reason, 'Comp grant')::text
    from public.comp_grants cg
    join public.class_sessions cs on cs.id = p_class_session_id
    where cg.profile_id = v_profile
      and cg.gym_id     = v_gym
      and cs.starts_at >= cg.starts_at
      and cs.starts_at <  cg.ends_at
      and cg.revoked_at is null
      and (cg.credits_total is null or cg.credits_remaining > 0)
      and (
        cardinality(cg.class_type_allowlist) = 0
        or cs.class_type_id = any(cg.class_type_allowlist)
      )
    union all
    select
      'plan_subscription'::public.entitlement_kind,
      ps.id,
      (v_default_kind = 'plan_subscription' and ps.id = v_default_id),
      mp.name
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    join public.class_sessions cs on cs.id = p_class_session_id
    where ps.profile_id = v_profile
      and ps.gym_id     = v_gym
      and (
        ps.status = 'active'
        or (ps.status = 'cancelled_at_period_end'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
        or (ps.status = 'refunded_retained'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
      )
      and (
        mp.kind = 'unlimited'
        or coalesce(ps.credit_balance, 0) > 0
      )
      and (
        not exists (
          select 1 from public.plan_class_types pct where pct.plan_id = ps.plan_id
        )
        or exists (
          select 1 from public.plan_class_types pct
          where pct.plan_id = ps.plan_id and pct.class_type_id = cs.class_type_id
        )
      );
end;
$$;
grant execute on function public.list_booking_entitlements(uuid, uuid) to authenticated;

-- ============================================================================
-- 5. is_active_relationship — broad cohort predicate (§0.6)
-- ============================================================================

create or replace function public.is_active_relationship(
  p_profile_id uuid,
  p_gym_id     uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with auth_ok as (
    select 1
    where p_profile_id = auth.uid()
       or public.user_can_assign_plan(p_gym_id)
  )
  select coalesce(
    (
      select
        exists (
          select 1 from public.plan_subscriptions ps
          where ps.profile_id = p_profile_id
            and ps.gym_id     = p_gym_id
            and ps.status in (
              'active',
              'pending',
              'paused',
              'cancelled_at_period_end'
            )
        )
        or exists (
          select 1 from public.comp_grants cg
          where cg.profile_id = p_profile_id
            and cg.gym_id     = p_gym_id
            and cg.revoked_at is null
            and now() >= cg.starts_at
            and now() <  cg.ends_at
        )
      from auth_ok
    ),
    false
  );
$$;
grant execute on function public.is_active_relationship(uuid, uuid) to authenticated;

-- ============================================================================
-- 6. has_ever_paid — strict cohort predicate (§0.6)
-- ============================================================================

-- Filters to charge-success event kinds: per plan §3.2, those are
-- charge.succeeded and invoice.paid. Refund events would also appear
-- in billing_events but must not register as paying activity.

create or replace function public.has_ever_paid(
  p_profile_id uuid,
  p_gym_id     uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with auth_ok as (
    select 1
    where p_profile_id = auth.uid()
       or public.user_can_assign_plan(p_gym_id)
  )
  select coalesce(
    (
      select exists (
        select 1 from public.billing_events be
        where be.member_id = p_profile_id
          and be.gym_id    = p_gym_id
          and be.kind in ('charge.succeeded', 'invoice.paid')
      )
      from auth_ok
    ),
    false
  );
$$;
grant execute on function public.has_ever_paid(uuid, uuid) to authenticated;
