-- Phase 1 / Track F: non-member tracking subscription (§5.4).
--
-- A member who leaves a gym can keep tracking their workouts via a
-- Temple-platform subscription. Billing flows through Temple's own
-- Stripe account — NOT a Connect account — so the schema and
-- webhook are deliberately separate from the gym-side billing
-- world. Sharing tables would collapse the trust boundary.
--
-- The workout_logs tables already support gym_id IS NULL, so a
-- non-member's logs persist exactly the same way they did when
-- they had a gym; the row stays portable.

create type public.platform_sub_status as enum (
  'active',
  'past_due',
  'cancelled',
  'trialing'
);

create table public.platform_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles(id) on delete cascade unique,
  stripe_customer_id     text not null,
  stripe_subscription_id text not null unique,
  status                 public.platform_sub_status not null default 'active',
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  created_at             timestamptz not null default now()
);

create index platform_subscriptions_status_idx on public.platform_subscriptions(status);

alter table public.platform_subscriptions enable row level security;

create policy platform_subscriptions_self_select on public.platform_subscriptions
  for select using (profile_id = auth.uid());

-- No insert/update/delete policies: service role only (signup edge
-- function + webhook handlers).

-- ============================================================================
-- platform_billing_events
--   Mirror of billing_events shape minus gym_id. Same idempotency
--   on (provider, provider_event_id). Members read their own;
--   nobody else.
-- ============================================================================

create table public.platform_billing_events (
  provider            text not null default 'stripe',
  provider_event_id   text not null,
  member_id           uuid not null references public.profiles(id),
  kind                text not null,
  amount_cents        integer not null,
  currency            text not null,
  occurred_at         timestamptz not null,
  payload             jsonb not null,
  primary key (provider, provider_event_id)
);

create index platform_billing_events_member_idx
  on public.platform_billing_events(member_id, occurred_at desc);

alter table public.platform_billing_events enable row level security;

create policy platform_billing_events_self_select on public.platform_billing_events
  for select using (member_id = auth.uid());

-- ============================================================================
-- record_platform_invoice_paid + record_platform_subscription_updated
--   Mirrors of the Connect-side webhook RPCs but scoped to the
--   platform-only tables. Idempotency via the billing_events PK.
-- ============================================================================

create or replace function public.record_platform_invoice_paid(
  p_event_id        text,
  p_subscription_id text,
  p_amount_cents    integer,
  p_currency        text,
  p_period_end      timestamptz,
  p_occurred_at     timestamptz,
  p_payload         jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  select profile_id into v_profile_id
  from public.platform_subscriptions
  where stripe_subscription_id = p_subscription_id;

  if v_profile_id is null then
    return;
  end if;

  begin
    insert into public.platform_billing_events (
      provider, provider_event_id, member_id,
      kind, amount_cents, currency, occurred_at, payload
    ) values (
      'stripe', p_event_id, v_profile_id,
      'invoice.paid', p_amount_cents, p_currency, p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  update public.platform_subscriptions
  set status             = case
                             when status in ('past_due', 'trialing') then 'active'
                             else status
                           end,
      current_period_end = coalesce(p_period_end, current_period_end)
  where stripe_subscription_id = p_subscription_id;
end;
$$;

create or replace function public.record_platform_subscription_updated(
  p_event_id        text,
  p_subscription_id text,
  p_stripe_status   text,
  p_period_end      timestamptz,
  p_cancel_at       timestamptz,
  p_occurred_at     timestamptz,
  p_payload         jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_new_state  public.platform_sub_status;
begin
  select profile_id into v_profile_id
  from public.platform_subscriptions
  where stripe_subscription_id = p_subscription_id;

  if v_profile_id is null then
    return;
  end if;

  begin
    insert into public.platform_billing_events (
      provider, provider_event_id, member_id,
      kind, amount_cents, currency, occurred_at, payload
    ) values (
      'stripe', p_event_id, v_profile_id,
      'customer.subscription.updated', 0, '', p_occurred_at, p_payload
    );
  exception when unique_violation then
    return;
  end;

  v_new_state := case p_stripe_status
    when 'active'   then 'active'
    when 'trialing' then 'trialing'
    when 'past_due' then 'past_due'
    when 'unpaid'   then 'past_due'
    when 'canceled' then 'cancelled'
    else null
  end;

  update public.platform_subscriptions
  set status             = coalesce(v_new_state, status),
      current_period_end = coalesce(p_period_end, current_period_end),
      cancel_at          = p_cancel_at
  where stripe_subscription_id = p_subscription_id;
end;
$$;
