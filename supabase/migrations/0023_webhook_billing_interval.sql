-- Phase 1 / Track B follow-up: thread billing_interval through the
-- Stripe webhook RPCs.
--
-- 0017 landed record_invoice_paid / record_subscription_updated
-- before 0020 added the billing_interval column. cancel_subscription
-- (0021) reads billing_interval to round notice expiry up to the
-- next period end, so the webhook needs to populate it whenever
-- Stripe gives us a recurring interval.
--
-- CREATE OR REPLACE with the new signature is safe — the old
-- versions weren't callable from authenticated yet (service-role
-- only via the webhook), so dropping/recreating doesn't break any
-- grants.

-- ============================================================================
-- 1. record_invoice_paid + billing_interval
-- ============================================================================

drop function if exists public.record_invoice_paid(
  text, text, text, integer, text, timestamptz, timestamptz, jsonb
);

create or replace function public.record_invoice_paid(
  p_event_id            text,
  p_account_id          text,
  p_subscription_id     text,
  p_amount_cents        integer,
  p_currency            text,
  p_paid_period_end     timestamptz,
  p_billing_interval    interval,
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
  select id, gym_id, profile_id, status
    into v_sub_id, v_gym_id, v_profile_id, v_old_status
  from public.plan_subscriptions
  where stripe_subscription_id = p_subscription_id
  limit 1;

  if v_sub_id is null then
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
      'invoice.paid', p_amount_cents, p_currency, p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  if v_old_status in ('scheduled', 'pending') then
    update public.plan_subscriptions
    set status                          = 'active',
        paid_period_end                 = p_paid_period_end,
        billing_interval                = coalesce(p_billing_interval, billing_interval),
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
        billing_interval                = coalesce(p_billing_interval, billing_interval),
        awaiting_payment_authentication = false
    where id = v_sub_id;
  end if;
end;
$$;

-- ============================================================================
-- 2. record_subscription_updated + billing_interval
-- ============================================================================

drop function if exists public.record_subscription_updated(
  text, text, text, text, timestamptz, timestamptz, jsonb
);

create or replace function public.record_subscription_updated(
  p_event_id        text,
  p_account_id      text,
  p_subscription_id text,
  p_stripe_status   text,
  p_paid_period_end timestamptz,
  p_billing_interval interval,
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

  update public.plan_subscriptions
  set paid_period_end  = coalesce(p_paid_period_end, paid_period_end),
      billing_interval = coalesce(p_billing_interval, billing_interval)
  where id = v_sub_id;

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
