-- Phase 1 / Track B: notice-period math + cancel_subscription RPC.
--
-- Authoritative server-side mirror of src/lib/billing/notice-math.ts.
-- The UI uses the TS version to preview "Access through {date}";
-- this RPC writes the same value. Keep them in lockstep — diverging
-- math is exactly the kind of money-paid/access-granted drift the
-- spec's invariant forbids.
--
-- This migration is split from 0020 because ALTER TYPE ... ADD VALUE
-- cannot reference the new enum value in the same transaction.

-- ============================================================================
-- 1. compute_cancellation_period_end
--    Pure math. now + notice_period gives notice_expires; the new
--    paid_period_end is the end of the billing period in which
--    notice_expires lands (whole periods only, no mid-period
--    overcharge). Falls back to now + notice when paid_period_end
--    or billing_interval is unknown.
--
--    plpgsql loop rather than ceil-and-multiply so calendar month
--    arithmetic stays exact (Postgres handles timestamp + interval
--    '1 month' correctly for variable month lengths; extract(epoch)
--    from '1 month' uses the 30-day approximation and would drift).
-- ============================================================================

create or replace function public.compute_cancellation_period_end(
  p_now              timestamptz,
  p_paid_period_end  timestamptz,
  p_billing_interval interval,
  p_notice_period    interval
) returns timestamptz
language plpgsql
immutable
as $$
declare
  v_notice_expires timestamptz := p_now + coalesce(p_notice_period, interval '0');
  v_end            timestamptz := p_paid_period_end;
  v_iter           integer := 0;
begin
  if p_paid_period_end is null or p_billing_interval is null
     or p_billing_interval = interval '0' then
    return v_notice_expires;
  end if;

  -- Hard cap matches the TS module: a malformed interval can't hang.
  while v_end < v_notice_expires and v_iter < 120 loop
    v_end := v_end + p_billing_interval;
    v_iter := v_iter + 1;
  end loop;

  return v_end;
end;
$$;

-- ============================================================================
-- 2. cancel_subscription
--    Self-cancel (member) or staff-cancel. Branches on current state:
--
--      active                       → cancelled_at_period_end with
--                                     paid_period_end advanced per
--                                     notice math.
--      paused                       → cancelled immediately (terminal).
--                                     Pause already stopped billing;
--                                     access cuts at the cancel call.
--
--    Refuses pending / scheduled / lapsed / refunded_retained /
--    cancelled* — those have other flows (delete pre-charge, dunning
--    recovery, refund, already-terminal).
--
--    Stripe side: this RPC writes DB state only. The wrapping edge
--    function (cancel-subscription) reads the new paid_period_end
--    out of the returned row and calls Stripe with cancel_at set
--    to that value (or cancels immediately for the paused branch).
-- ============================================================================

create or replace function public.cancel_subscription(
  p_plan_subscription_id uuid
) returns table (
  new_status          public.plan_sub_state,
  new_paid_period_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub          public.plan_subscriptions;
  v_notice       interval;
  v_new_end      timestamptz;
  v_actor        uuid := auth.uid();
  v_target_state public.plan_sub_state;
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

  -- Authorisation: self or staff with assign-plan capability.
  if v_sub.profile_id <> v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    raise exception 'Not authorised to cancel this subscription';
  end if;

  -- Read notice from the plan.
  select notice_period into v_notice
  from public.membership_plans
  where plan_id = v_sub.plan_id;

  if v_sub.status = 'active' then
    v_target_state := 'cancelled_at_period_end';
    v_new_end := public.compute_cancellation_period_end(
      now(),
      v_sub.paid_period_end,
      v_sub.billing_interval,
      coalesce(v_notice, interval '0')
    );
  elsif v_sub.status = 'paused' then
    v_target_state := 'cancelled';
    -- Pause already held billing; access ends at the cancel call.
    -- paid_period_end is preserved for the audit trail but no longer
    -- gates eligibility (cancelled is terminal-ineligible).
    v_new_end := v_sub.paid_period_end;
  else
    raise exception
      'Cannot cancel subscription in status %', v_sub.status;
  end if;

  update public.plan_subscriptions
  set status          = v_target_state,
      paid_period_end = v_new_end,
      cancelled_at    = now()
  where id = v_sub.id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_sub.gym_id,
    v_actor,
    'plan_subscription',
    v_sub.id,
    case v_target_state
      when 'cancelled_at_period_end' then 'plan_sub_cancelled_at_period_end'
      when 'cancelled'               then 'plan_sub_cancelled'
    end,
    jsonb_build_object(
      'previous_status',    v_sub.status::text,
      'paid_period_end',    v_new_end,
      'notice_period',      v_notice,
      'billing_interval',   v_sub.billing_interval,
      'self_cancelled',     v_sub.profile_id = v_actor
    )
  );

  return query select v_target_state, v_new_end;
end;
$$;

grant execute on function public.cancel_subscription(uuid) to authenticated;
