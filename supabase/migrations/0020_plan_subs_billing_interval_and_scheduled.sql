-- Phase 1 / Track B prep: billing_interval column + scheduled state.
--
-- The cancel_subscription RPC (next migration) needs to know each
-- subscription's billing cadence to round notice-period expiry up
-- to the next billing period end. Stripe's recurring price interval
-- is the authoritative value; the webhook handler will populate
-- this column from subscription.items.data[0].price.recurring on
-- customer.subscription.updated.
--
-- ALTER TYPE ... ADD VALUE has to land in its own transaction so the
-- value is visible to subsequent migrations that reference it (e.g.
-- the signup_member RPC). That's why the enum change is here rather
-- than alongside the RPC.

alter table public.plan_subscriptions
  add column billing_interval interval;

-- The 'scheduled' state: future-dated signup, distinct from SCA-in-flight
-- 'pending'. See docs/entitlement-states.md amendments for the full
-- transition semantics.
alter type public.plan_sub_state add value 'scheduled' after 'pending';

-- Keep is_active_relationship inclusive of scheduled subs — a member
-- who has signed up for a future-dated plan is in an active
-- relationship with the gym even before billing kicks in.
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
              'scheduled',
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
