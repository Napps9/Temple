-- Phase 1 last-mile: checkout.session.completed handler.
--
-- Fires after Stripe Checkout finishes — the member entered card
-- details and Stripe created the Customer and Subscription. We
-- read the metadata we attached at session creation
-- (gym_id / profile_id / plan_id), look up billing details from the
-- subscription, and write the plan_subscriptions row in pending or
-- scheduled state via signup_member's underlying writes.
--
-- Idempotent via webhook_events. The subsequent invoice.paid
-- event then flips pending → active through record_invoice_paid.

create or replace function public.record_checkout_session_completed(
  p_event_id            text,
  p_account_id          text,
  p_gym_id              uuid,
  p_profile_id          uuid,
  p_plan_id             uuid,
  p_stripe_customer_id  text,
  p_stripe_subscription_id text,
  p_billing_interval    interval,
  p_paid_period_end     timestamptz,
  p_occurred_at         timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership_id uuid;
  v_credit_count  integer;
  v_period_length interval;
  v_sub_id        uuid;
begin
  begin
    insert into public.webhook_events (
      provider, provider_event_id, kind, occurred_at
    ) values (
      'stripe', p_event_id, 'checkout.session.completed', p_occurred_at
    );
  exception when unique_violation then
    return;
  end;

  -- Required: the member's gym_memberships row.
  select id into v_membership_id
  from public.gym_memberships
  where gym_id = p_gym_id and profile_id = p_profile_id;
  if v_membership_id is null then
    -- No relationship row; nothing to write. The checkout still
    -- succeeded in Stripe; ops will reconcile manually.
    return;
  end if;

  -- Don't double-insert if the row already exists for this Stripe
  -- subscription (idempotency safety beyond webhook_events).
  select id into v_sub_id
  from public.plan_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id;
  if v_sub_id is not null then
    return;
  end if;

  select credit_count, period_length
    into v_credit_count, v_period_length
  from public.membership_plans where plan_id = p_plan_id;

  insert into public.stripe_customers (gym_id, profile_id, customer_id, last_synced_at)
  values (p_gym_id, p_profile_id, p_stripe_customer_id, now())
  on conflict (gym_id, profile_id) do update
    set customer_id    = excluded.customer_id,
        last_synced_at = excluded.last_synced_at;

  insert into public.plan_subscriptions (
    gym_membership_id, profile_id, gym_id, plan_id,
    status, credit_balance, period_resets_at, paid_period_end,
    stripe_subscription_id, billing_interval
  ) values (
    v_membership_id, p_profile_id, p_gym_id, p_plan_id,
    'pending',
    v_credit_count,
    case when v_period_length is not null then now() + v_period_length else null end,
    p_paid_period_end,
    p_stripe_subscription_id,
    p_billing_interval
  )
  returning id into v_sub_id;

  insert into public.audit_events (
    gym_id, subject_kind, subject_id, kind, payload
  ) values (
    p_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_pending',
    jsonb_build_object(
      'plan_id',         p_plan_id,
      'stripe_sub_id',   p_stripe_subscription_id,
      'via_checkout',    true,
      'stripe_event_id', p_event_id
    )
  );
end;
$$;
