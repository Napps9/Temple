-- Phase 3 Tier 6: soft-delete columns, storage bucket, price snapshot,
-- and left_at-aware eligibility predicates.
--
-- Removal model: archive (reversible) for class_types and
-- membership_plans; "leave" (reversible) for gym_memberships. True
-- destruction is Phase 4 GDPR. `left_at IS NULL` propagates through
-- is_active_relationship and is_booking_eligible — one column flip in
-- leave_gym closes the door across eligibility, booking, waitlist
-- promotion, and (once Stripe lands) billing.
--
-- Grandfathered price: plan_subscriptions.price_cents is the price the
-- sub pays. Snapshotted on insert; never re-read from the parent plan.
-- "Apply new price to existing members" is a Phase 5 campaign with
-- comms (CMA territory); not in this tier.
--
-- Avatars bucket is public on purpose — avatars are low-sensitivity
-- and cross-gym visible by design. No read policy (a public bucket
-- serves URLs without RLS, so a same-gym read policy would be false
-- security). Write policy IS enforced — files live under
-- <own_profile_id>/...

-- ============================================================================
-- 1. Columns
-- ============================================================================

alter table public.class_types
  add column archived_at timestamptz;

alter table public.gym_memberships
  add column left_at timestamptz;

alter table public.plan_subscriptions
  add column price_cents integer;

alter table public.class_bookings
  add column promoted_from_waitlist boolean not null default false;

-- ============================================================================
-- 2. Partial indexes for the hot "active row" lookups
-- ============================================================================

create index class_types_gym_active_idx
  on public.class_types(gym_id)
  where archived_at is null;

create index gym_memberships_gym_active_idx
  on public.gym_memberships(gym_id)
  where left_at is null;

-- ============================================================================
-- 3. Snapshot price on insert
-- ============================================================================
-- price_cents is the price the sub pays. It's set once at signup from
-- the plan's monthly_price_cents and is never auto-updated by a plan
-- price edit — that's the whole grandfathered-pricing invariant.

create or replace function public.plan_subscriptions_snapshot_price()
returns trigger
language plpgsql
as $$
begin
  if new.price_cents is null then
    select monthly_price_cents into new.price_cents
      from public.membership_plans
      where plan_id = new.plan_id;
  end if;
  return new;
end;
$$;

create trigger plan_subscriptions_snapshot_price_trg
  before insert on public.plan_subscriptions
  for each row execute function public.plan_subscriptions_snapshot_price();

-- ============================================================================
-- 4. Predicate updates: removal propagates everywhere left_at is honored
-- ============================================================================
-- is_active_relationship is the root-cause fix; is_booking_eligible
-- gets the same gym_memberships join because it doesn't call the
-- relationship predicate transitively.

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
          select 1 from public.gym_memberships gm
          where gm.gym_id = p_gym_id
            and gm.profile_id = p_profile_id
            and gm.left_at is null
        )
        and (
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
        )
      from auth_ok
    ),
    false
  );
$$;

-- _is_booking_eligible_for evaluates eligibility WITHOUT the caller-vs-target
-- auth check, so it can be called from trigger contexts (where auth.uid() is
-- the user whose action fired the trigger, NOT the user being evaluated).
-- Mirrors the _book_class_for split: public wrappers gate by caller identity,
-- internal helpers operate on data the caller has already been authorised to
-- act on. The promote_from_waitlist trigger relies on this — without it,
-- every waitlister was failing eligibility because auth.uid() was the
-- cancelling member, not the queued one.
--
-- Defined BEFORE the public is_booking_eligible wrapper: psql/Postgres
-- validate language sql function bodies at creation, so the wrapper would
-- abort with "function does not exist" if the helper isn't already there.
create or replace function public._is_booking_eligible_for(
  p_profile_id       uuid,
  p_gym_id           uuid,
  p_class_session_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select
        exists (
          select 1 from public.gym_memberships gm
          where gm.gym_id = p_gym_id
            and gm.profile_id = p_profile_id
            and gm.left_at is null
        )
        and (
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
        )
    ),
    false
  );
$$;

-- Lock the no-caller-auth helper out of the PostgREST surface: it must be
-- callable from SECURITY DEFINER code (triggers, the public wrapper) but
-- never as an RPC, because it skips the caller-vs-target check.
revoke execute on function public._is_booking_eligible_for(uuid, uuid, uuid)
  from public, anon, authenticated;

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
  select case
    when p_profile_id = auth.uid()
      or public.user_can_assign_plan(p_gym_id)
    then public._is_booking_eligible_for(p_profile_id, p_gym_id, p_class_session_id)
    else false
  end;
$$;

-- ============================================================================
-- 5. v_member_cohort filters out left members
-- ============================================================================

create or replace view public.v_member_cohort
with (security_invoker = on)
as
with cohort as (
  select
    gm.gym_id,
    gm.profile_id,
    gm.created_at as joined_at,
    public.has_ever_paid(gm.profile_id, gm.gym_id)         as is_paying,
    public.is_active_relationship(gm.profile_id, gm.gym_id) as is_active,
    (
      select min(extract(day from (ps.paid_period_end - now())))::integer
      from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
        and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
        and ps.paid_period_end is not null
        and ps.paid_period_end > now()
    ) as plan_days_until_expiry,
    (
      select min(extract(day from (cg.ends_at - now())))::integer
      from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and cg.ends_at > now()
    ) as comp_days_until_expiry,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and now() >= cg.starts_at
        and now() <  cg.ends_at
    ) as has_live_comp,
    exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
    ) as ever_had_plan,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
    ) as ever_had_comp
  from public.gym_memberships gm
  where gm.role = 'member'
    and gm.left_at is null
)
select
  c.gym_id,
  c.profile_id,
  c.joined_at,
  (c.has_live_comp and not c.is_paying)             as is_intro,
  c.is_paying,
  c.is_active,
  least(c.plan_days_until_expiry, c.comp_days_until_expiry) as days_until_expiry,
  (
    least(c.plan_days_until_expiry, c.comp_days_until_expiry) is not null
    and least(c.plan_days_until_expiry, c.comp_days_until_expiry) between 0 and 7
  ) as is_expiring_soon,
  (
    not c.is_active
    and (c.ever_had_plan or c.ever_had_comp)
  ) as is_expired
from cohort c;

grant select on public.v_member_cohort to authenticated;

-- ============================================================================
-- 6. Storage bucket: avatars
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- No SELECT policy by design — bucket is public; a same-gym check
-- would be false security.

drop policy if exists avatars_write_own_folder on storage.objects;
create policy avatars_write_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists avatars_update_own_folder on storage.objects;
create policy avatars_update_own_folder on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists avatars_delete_own_folder on storage.objects;
create policy avatars_delete_own_folder on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- 7. Dependents helpers — gate the hard-delete RPCs in 0017
-- ============================================================================

create or replace function public.class_type_has_dependents(p_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.class_sessions where class_type_id = p_id
  ) or exists (
    select 1 from public.class_recurrences where class_type_id = p_id
  ) or exists (
    select 1 from public.class_programming where class_type_id = p_id
  ) or exists (
    select 1 from public.plan_class_types where class_type_id = p_id
  );
$$;
grant execute on function public.class_type_has_dependents(uuid) to authenticated;

create or replace function public.plan_has_dependents(p_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.plan_subscriptions where plan_id = p_id
  );
$$;
grant execute on function public.plan_has_dependents(uuid) to authenticated;

create or replace function public.member_has_dependents(p_gym_id uuid, p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.class_bookings
    where gym_id = p_gym_id and profile_id = p_profile_id
  ) or exists (
    select 1 from public.plan_subscriptions
    where gym_id = p_gym_id and profile_id = p_profile_id
  ) or exists (
    select 1 from public.comp_grants
    where gym_id = p_gym_id and profile_id = p_profile_id
  ) or exists (
    select 1 from public.billing_events
    where gym_id = p_gym_id and member_id = p_profile_id
  );
$$;
grant execute on function public.member_has_dependents(uuid, uuid) to authenticated;

-- ============================================================================
-- 8. Inverted-enumeration helper for sub status
-- ============================================================================
-- Terminal = no further state changes expected, no longer entitling.
-- leave_gym cancels anything NOT terminal so a future-added entitling
-- state (e.g. Stripe 'scheduled') is caught by default rather than
-- silently slipping past an enumerate-the-good list.

create or replace function public.is_terminal_subscription_status(p_status public.plan_sub_state)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('lapsed', 'cancelled');
$$;
grant execute on function public.is_terminal_subscription_status(public.plan_sub_state) to authenticated;
