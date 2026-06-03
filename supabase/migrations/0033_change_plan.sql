-- Phase 1 / Track B: change_plan + affected-bookings preview (§3.2).
--
-- Upgrade / downgrade swap a member's plan in place rather than
-- cancel + resubscribe. The Stripe-side proration math lives in the
-- wrapping edge function; this migration is the DB side.
--
-- Eligibility-at-class-date principle (carried over from pause):
-- when the new plan's class-type allowlist would exclude a class
-- the member already has booked, the booking is "affected". The
-- preview RPC surfaces these so the confirmation modal can offer
-- cancel / reschedule / leave per booking — never a silent release
-- after the fact.
--
-- For sprint 3 the affected set is computed from class-type
-- allowlists only. Credit-balance shortfalls on credit-period plans
-- are a sprint 4 refinement.

-- ============================================================================
-- 1. get_affected_bookings_on_plan_change
--    Returns the future class_sessions the member has booked that
--    the new plan would not cover. Authorisation mirrors
--    cancel_subscription: self or staff.
-- ============================================================================

create or replace function public.get_affected_bookings_on_plan_change(
  p_plan_subscription_id uuid,
  p_new_plan_id          uuid
) returns table (
  booking_id        uuid,
  class_session_id  uuid,
  starts_at         timestamptz,
  class_type_id     uuid,
  class_type_name   text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_sub        public.plan_subscriptions;
  v_actor      uuid := auth.uid();
  v_has_list   boolean;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sub
  from public.plan_subscriptions
  where id = p_plan_subscription_id;
  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;

  if v_sub.profile_id <> v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    raise exception 'Not authorised to preview this plan change';
  end if;

  -- Verify the new plan exists at the same gym.
  if not exists (
    select 1 from public.membership_plans
    where plan_id = p_new_plan_id and gym_id = v_sub.gym_id
  ) then
    raise exception 'New plan not found at this gym';
  end if;

  -- If the new plan has no class_type allowlist (empty = all), no
  -- bookings are affected by allowlist alone.
  v_has_list := exists (
    select 1 from public.plan_class_types where plan_id = p_new_plan_id
  );
  if not v_has_list then
    return;
  end if;

  return query
    select cb.id              as booking_id,
           cs.id               as class_session_id,
           cs.starts_at,
           cs.class_type_id,
           ct.name             as class_type_name
    from public.class_bookings cb
    join public.class_sessions cs on cs.id = cb.class_session_id
    left join public.class_types ct on ct.id = cs.class_type_id
    where cb.profile_id = v_sub.profile_id
      and cb.gym_id     = v_sub.gym_id
      and cs.starts_at  >  now()
      and (
        cs.class_type_id is null
        or not exists (
          select 1 from public.plan_class_types pct
          where pct.plan_id       = p_new_plan_id
            and pct.class_type_id = cs.class_type_id
        )
      )
    order by cs.starts_at asc;
end;
$$;

grant execute on function public.get_affected_bookings_on_plan_change(uuid, uuid) to authenticated;

-- ============================================================================
-- 2. change_plan
--    In-place plan swap. Updates plan_id, recomputes credit_balance
--    from the new plan, emits an audit row. Stripe-side proration
--    (immediate charge for upgrade; credit-on-next-bill for
--    downgrade) is the edge function's job.
-- ============================================================================

create or replace function public.change_plan(
  p_plan_subscription_id uuid,
  p_new_plan_id          uuid
) returns table (
  previous_plan_id uuid,
  new_plan_id      uuid,
  new_credit_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub          public.plan_subscriptions;
  v_actor        uuid := auth.uid();
  v_new_plan     public.membership_plans;
  v_old_plan_id  uuid;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sub
  from public.plan_subscriptions
  where id = p_plan_subscription_id;
  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;

  if v_sub.status <> 'active' then
    raise exception 'Cannot change plan on subscription in status %', v_sub.status;
  end if;

  if v_sub.profile_id <> v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    raise exception 'Not authorised to change this plan';
  end if;

  select * into v_new_plan
  from public.membership_plans
  where plan_id = p_new_plan_id and gym_id = v_sub.gym_id;
  if v_new_plan.plan_id is null then
    raise exception 'New plan not found at this gym';
  end if;

  if v_new_plan.plan_id = v_sub.plan_id then
    raise exception 'New plan is the same as current plan';
  end if;

  v_old_plan_id := v_sub.plan_id;

  update public.plan_subscriptions
  set plan_id        = v_new_plan.plan_id,
      credit_balance = v_new_plan.credit_count,
      period_resets_at = case
        when v_new_plan.period_length is not null then now() + v_new_plan.period_length
        else null
      end
  where id = v_sub.id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_sub.gym_id,
    v_actor,
    'plan_subscription',
    v_sub.id,
    'plan_changed',
    jsonb_build_object(
      'previous_plan_id', v_old_plan_id,
      'new_plan_id',      v_new_plan.plan_id,
      'self_initiated',   v_sub.profile_id = v_actor
    )
  );

  return query
    select v_old_plan_id, v_new_plan.plan_id, v_new_plan.credit_count;
end;
$$;

grant execute on function public.change_plan(uuid, uuid) to authenticated;
