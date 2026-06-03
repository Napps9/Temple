-- Phase 1 / Track B: refund_payment RPC + charge.refunded handler.
--
-- §3.5 Owner-only refund flow. Two axes:
--   amount         — full charge or partial.
--   retain_access  — keep access through paid_period_end (terminal
--                    at paid_period_end via the existing
--                    refunded_retained → cancelled cron in 0016) or
--                    cut access immediately (cancelled, paid_period_end
--                    = now()).
--
-- The default is retain_access = true (spec: "must not auto-revoke
-- access on refund"). The Owner UI surfaces the toggle explicitly.
--
-- Flow:
--   1. Edge function refund-payment calls Stripe to issue the refund
--      against the latest successful charge for this subscription.
--   2. Edge function calls this RPC with (sub_id, amount, retain,
--      stripe_refund_id). RPC updates plan_subscriptions + audits.
--   3. Stripe later fires charge.refunded → webhook routes to
--      record_charge_refunded → inserts billing_events → the
--      receipt trigger (0025) enqueues the refund-processed email.
--
-- We deliberately do NOT insert billing_events from this RPC: the
-- webhook is the canonical source of charge events, and double-inserts
-- would fire two receipts.

-- ============================================================================
-- 1. refund_payment
-- ============================================================================

create or replace function public.refund_payment(
  p_plan_subscription_id uuid,
  p_amount_cents         integer,
  p_retain_access        boolean,
  p_stripe_refund_id     text
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
  v_actor        uuid := auth.uid();
  v_target_state public.plan_sub_state;
  v_new_end      timestamptz;
  v_role         public.gym_role;
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

  -- Owner only — mirrors src/lib/can.ts::can_refund.
  select role into v_role
  from public.gym_memberships
  where gym_id = v_sub.gym_id and profile_id = v_actor;
  if v_role is null or v_role <> 'owner' then
    raise exception 'Only the gym owner may refund';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'refund amount must be positive';
  end if;

  if p_retain_access then
    -- Status flips only from active / cancelled_at_period_end. Refunds
    -- on already-terminal subs (cancelled, lapsed) don't reanimate
    -- them; the refund still goes through but status stays.
    if v_sub.status in ('active', 'cancelled_at_period_end') then
      v_target_state := 'refunded_retained';
    else
      v_target_state := v_sub.status;
    end if;
    v_new_end := v_sub.paid_period_end;
  else
    v_target_state := 'cancelled';
    v_new_end      := now();
  end if;

  update public.plan_subscriptions
  set status          = v_target_state,
      paid_period_end = v_new_end,
      cancelled_at    = case when v_target_state = 'cancelled' then now() else cancelled_at end
  where id = v_sub.id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_sub.gym_id,
    v_actor,
    'plan_subscription',
    v_sub.id,
    case
      when p_retain_access then 'plan_sub_refunded_retained'
      else                      'plan_sub_cancelled_via_refund'
    end,
    jsonb_build_object(
      'amount_cents',      p_amount_cents,
      'retain_access',     p_retain_access,
      'stripe_refund_id',  p_stripe_refund_id,
      'previous_status',   v_sub.status::text
    )
  );

  return query select v_target_state, v_new_end;
end;
$$;

grant execute on function public.refund_payment(uuid, integer, boolean, text) to authenticated;

-- ============================================================================
-- 2. record_charge_refunded — webhook handler
--    Inserts the billing_events row that fires the refund receipt
--    via the trigger in 0025. Status was already updated by
--    refund_payment (for Temple-initiated refunds) or stays as-is
--    for Stripe-dashboard refunds; the webhook does NOT mutate
--    plan_subscriptions.status to avoid racing the RPC.
-- ============================================================================

create or replace function public.record_charge_refunded(
  p_event_id         text,
  p_account_id       text,
  p_subscription_id  text,
  p_amount_cents     integer,
  p_currency         text,
  p_occurred_at      timestamptz,
  p_payload          jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id     uuid;
  v_gym_id     uuid;
  v_profile_id uuid;
begin
  if p_subscription_id is not null then
    select id, gym_id, profile_id
      into v_sub_id, v_gym_id, v_profile_id
    from public.plan_subscriptions
    where stripe_subscription_id = p_subscription_id
    limit 1;
  end if;

  -- billing_events.member_id is NOT NULL. If we can't resolve a
  -- member (e.g. a Stripe-dashboard refund against a charge we
  -- don't track), drop the event silently. Webhook returns 200 so
  -- Stripe stops retrying.
  if v_profile_id is null then
    return;
  end if;

  begin
    insert into public.billing_events (
      provider, provider_event_id, provider_account_id,
      gym_id, plan_subscription_id, member_id,
      kind, amount_cents, currency, occurred_at, payload
    ) values (
      'stripe', p_event_id, p_account_id,
      v_gym_id, v_sub_id, v_profile_id,
      'charge.refunded', p_amount_cents, p_currency, p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  if v_sub_id is not null then
    insert into public.audit_events (
      gym_id, subject_kind, subject_id, kind, payload
    ) values (
      v_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_charge_refunded',
      jsonb_build_object(
        'stripe_event_id', p_event_id,
        'amount_cents',    p_amount_cents
      )
    );
  end if;
end;
$$;
