-- Phase 1 / Track A: webhook-side RPCs.
--
-- The Stripe webhook is the only writer of pending → active and
-- active → lapsed. To keep that transition atomic with the
-- billing_events insert and the audit_events emit, the JS handler
-- calls one of these SECURITY DEFINER RPCs rather than running
-- three separate writes. Stripe retries on 5xx, so partial work
-- has to be avoided.
--
-- Idempotency: billing_events PK is (provider, provider_event_id).
-- If the insert raises unique_violation, the RPC returns early and
-- the JS handler responds 200 — the event has already been recorded
-- and applied.

-- ============================================================================
-- 1. record_invoice_paid
--    Activates the subscription from any pre-active non-terminal
--    state (scheduled OR pending → active). For future-dated subs,
--    Stripe's invoice.paid fires at trial_end = starts_at — event-
--    driven, on the dot — which can arrive before the hourly
--    scheduled → pending cron flips the row. Activating from
--    scheduled directly closes that race.
-- ============================================================================

create or replace function public.record_invoice_paid(
  p_event_id            text,
  p_account_id          text,
  p_subscription_id     text,
  p_amount_cents        integer,
  p_currency            text,
  p_paid_period_end     timestamptz,
  p_occurred_at         timestamptz,
  p_payload             jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id     uuid;
  v_gym_id     uuid;
  v_profile_id uuid;
  v_old_status public.plan_sub_state;
begin
  -- Resolve the plan_subscription. No row = unknown sub; nothing to
  -- record. Returning here would mean Stripe keeps retrying. Better
  -- to record what we can and log; for now, no-op.
  select id, gym_id, profile_id, status
    into v_sub_id, v_gym_id, v_profile_id, v_old_status
  from public.plan_subscriptions
  where stripe_subscription_id = p_subscription_id
  limit 1;

  if v_sub_id is null then
    return;
  end if;

  -- Insert billing_events first; PK conflict means we've already
  -- processed this event — return without touching state.
  begin
    insert into public.billing_events (
      provider, provider_event_id, provider_account_id,
      gym_id, plan_subscription_id, member_id,
      kind, amount_cents, currency, occurred_at, payload
    ) values (
      'stripe', p_event_id, p_account_id,
      v_gym_id, v_sub_id, v_profile_id,
      'invoice.paid', p_amount_cents, p_currency, p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  -- Activate from scheduled OR pending. Already-active subs only get
  -- their paid_period_end refreshed (period renewal).
  if v_old_status in ('scheduled', 'pending') then
    update public.plan_subscriptions
    set status                          = 'active',
        paid_period_end                 = p_paid_period_end,
        awaiting_payment_authentication = false
    where id = v_sub_id;

    insert into public.audit_events (
      gym_id, subject_kind, subject_id, kind, payload
    ) values (
      v_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_active',
      jsonb_build_object(
        'previous_status', v_old_status::text,
        'stripe_event_id', p_event_id
      )
    );
  elsif v_old_status = 'active' then
    update public.plan_subscriptions
    set paid_period_end                 = p_paid_period_end,
        awaiting_payment_authentication = false
    where id = v_sub_id;
  end if;
end;
$$;

-- Not granted to authenticated; service-role only via the webhook.

-- ============================================================================
-- 2. record_subscription_updated
--    Syncs paid_period_end on renewal; drives active → lapsed when
--    Stripe reports the sub as unpaid (post-dunning).
-- ============================================================================

create or replace function public.record_subscription_updated(
  p_event_id        text,
  p_account_id      text,
  p_subscription_id text,
  p_stripe_status   text,
  p_paid_period_end timestamptz,
  p_occurred_at     timestamptz,
  p_payload         jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id     uuid;
  v_gym_id     uuid;
  v_profile_id uuid;
  v_old_status public.plan_sub_state;
begin
  select id, gym_id, profile_id, status
    into v_sub_id, v_gym_id, v_profile_id, v_old_status
  from public.plan_subscriptions
  where stripe_subscription_id = p_subscription_id
  limit 1;

  if v_sub_id is null then
    return;
  end if;

  -- Idempotency mirror of record_invoice_paid: drop a billing_events
  -- row so re-deliveries are no-ops. Subscription-updated events
  -- aren't charges, so amount_cents is 0 and the kind tags the
  -- nature.
  begin
    insert into public.billing_events (
      provider, provider_event_id, provider_account_id,
      gym_id, plan_subscription_id, member_id,
      kind, amount_cents, currency, occurred_at, payload
    ) values (
      'stripe', p_event_id, p_account_id,
      v_gym_id, v_sub_id, v_profile_id,
      'customer.subscription.updated', 0, '', p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  -- Always sync paid_period_end if Stripe reports a value.
  if p_paid_period_end is not null then
    update public.plan_subscriptions
    set paid_period_end = p_paid_period_end
    where id = v_sub_id;
  end if;

  -- active → lapsed when Stripe reports the sub as unpaid (dunning
  -- exhausted). cancel_at_period_end / cancelled flows are owned by
  -- Track B's cancel_subscription RPC and don't enter here.
  if p_stripe_status = 'unpaid' and v_old_status = 'active' then
    update public.plan_subscriptions
    set status = 'lapsed'
    where id = v_sub_id;

    insert into public.audit_events (
      gym_id, subject_kind, subject_id, kind, payload
    ) values (
      v_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_lapsed',
      jsonb_build_object(
        'previous_status', v_old_status::text,
        'stripe_event_id', p_event_id
      )
    );
  end if;
end;
$$;
