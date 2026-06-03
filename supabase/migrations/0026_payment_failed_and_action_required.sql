-- Phase 1 / Track A + C: invoice.payment_failed and
-- invoice.payment_action_required webhook RPCs.
--
-- §3.1 forbids writing a billing_events row on failed charges, so
-- the existing (provider, provider_event_id) PK on billing_events
-- can't dedupe these events. A small webhook_events table fills
-- that gap for non-financial Stripe events. Financial events
-- (invoice.paid, charge.refunded) continue to dedupe via
-- billing_events; the two systems coexist.
--
-- Dunning email: payment_failed enqueues a messages row directly
-- (no trigger — see 0025 for why). Status stays 'active' during
-- the dunning window; only when Stripe later marks the sub
-- 'unpaid' does customer.subscription.updated drive
-- active → lapsed (record_subscription_updated, 0023).
--
-- SCA leg: payment_action_required flips the
-- awaiting_payment_authentication side-state and enqueues a
-- confirm-payment email. The webhook clears the flag on the next
-- invoice.paid via record_invoice_paid.

-- ============================================================================
-- 1. webhook_events — idempotency log for non-financial events
-- ============================================================================

create table public.webhook_events (
  provider          text not null default 'stripe',
  provider_event_id text not null,
  kind              text not null,
  occurred_at       timestamptz not null,
  processed_at      timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

create index webhook_events_occurred_at_idx on public.webhook_events(occurred_at);

alter table public.webhook_events enable row level security;
-- No policies: service-role only.

-- ============================================================================
-- 2. record_invoice_payment_failed
--    Enqueues a dunning email; does NOT modify plan_subscription
--    status (dunning window keeps the member 'active'). Side-state
--    awaiting_payment_authentication is independent and stays as is.
-- ============================================================================

create or replace function public.record_invoice_payment_failed(
  p_event_id        text,
  p_subscription_id text,
  p_occurred_at     timestamptz
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
  begin
    insert into public.webhook_events (
      provider, provider_event_id, kind, occurred_at
    ) values (
      'stripe', p_event_id, 'invoice.payment_failed', p_occurred_at
    );
  exception when unique_violation then
    return;
  end;

  select id, gym_id, profile_id
    into v_sub_id, v_gym_id, v_profile_id
  from public.plan_subscriptions
  where stripe_subscription_id = p_subscription_id
  limit 1;

  if v_sub_id is null then
    return;
  end if;

  insert into public.messages (
    gym_id, channel, system_kind, recipient_profile_id, context
  ) values (
    v_gym_id,
    'email',
    'payment_failed',
    v_profile_id,
    jsonb_build_object(
      'stripe_event_id',      p_event_id,
      'stripe_subscription_id', p_subscription_id,
      'occurred_at',          p_occurred_at
    )
  );

  insert into public.audit_events (
    gym_id, subject_kind, subject_id, kind, payload
  ) values (
    v_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_payment_failed',
    jsonb_build_object('stripe_event_id', p_event_id)
  );
end;
$$;

-- ============================================================================
-- 3. record_invoice_payment_action_required
--    Sets awaiting_payment_authentication and enqueues a confirm
-- 	email. Status untouched.
-- ============================================================================

create or replace function public.record_invoice_payment_action_required(
  p_event_id        text,
  p_subscription_id text,
  p_occurred_at     timestamptz
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
  begin
    insert into public.webhook_events (
      provider, provider_event_id, kind, occurred_at
    ) values (
      'stripe', p_event_id, 'invoice.payment_action_required', p_occurred_at
    );
  exception when unique_violation then
    return;
  end;

  select id, gym_id, profile_id
    into v_sub_id, v_gym_id, v_profile_id
  from public.plan_subscriptions
  where stripe_subscription_id = p_subscription_id
  limit 1;

  if v_sub_id is null then
    return;
  end if;

  update public.plan_subscriptions
  set awaiting_payment_authentication = true
  where id = v_sub_id;

  insert into public.messages (
    gym_id, channel, system_kind, recipient_profile_id, context
  ) values (
    v_gym_id,
    'email',
    'payment_action_required',
    v_profile_id,
    jsonb_build_object(
      'stripe_event_id',        p_event_id,
      'stripe_subscription_id', p_subscription_id,
      'occurred_at',            p_occurred_at
    )
  );

  insert into public.audit_events (
    gym_id, subject_kind, subject_id, kind, payload
  ) values (
    v_gym_id, 'plan_subscription', v_sub_id, 'plan_sub_action_required',
    jsonb_build_object('stripe_event_id', p_event_id)
  );
end;
$$;
