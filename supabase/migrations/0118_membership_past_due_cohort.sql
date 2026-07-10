-- Retention cockpit, Phase 1a — treat a past_due membership as an active
-- (at-risk) relationship, not a churned one.
--
-- A member whose renewal is failing hasn't left — they're a current member
-- with a payment problem. Without this, once the webhook flips a failing
-- membership to 'past_due', is_active_relationship would report false and
-- v_member_cohort would classify them is_expired (ever_had_plan and not
-- is_active) — miscounting a payment problem as a departure.
--
-- So 'past_due' joins the active-status set. v_member_cohort reads
-- is_active_relationship for its is_active flag, so re-emitting the function
-- updates the view with no view change. The cohort's own TS mirror
-- (src/lib/booking-picker.ts ACTIVE_SUB_STATUSES) gains 'past_due' in the
-- same change to keep SQL<->TS parity (insights.fixtures.ts).
--
-- Booking is deliberately NOT extended to past_due: the booking-eligibility
-- predicate still requires 'active' (or a paid-through cancel/refund state),
-- so a past_due member is refused a booking until their payment recovers —
-- the failed charge becomes payment-recovery pressure rather than free
-- access. Whether to grant a paid-through grace instead is an owner call
-- left for later.

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
              'cancelled_at_period_end',
              'past_due'
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
