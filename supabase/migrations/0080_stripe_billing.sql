-- Stripe billing Phase 2: link plans, subscriptions, and customers to
-- Stripe so members can be charged on the gym's connected account.
-- Direct charges, no platform fee. The checkout + webhook edge functions
-- write all of this (service role); clients never read the Stripe ids.
--
--   membership_plans.stripe_price_id  — cached Price on the connected
--       account, created lazily at first checkout.
--   plan_subscriptions.stripe_subscription_id / stripe_customer_id —
--       set by the webhook when a checkout completes.
--   gym_stripe_customers — one Stripe Customer per (gym, member) on the
--       gym's connected account, so repeat checkouts reuse it.

begin;

alter table public.membership_plans
  add column if not exists stripe_price_id text;

alter table public.plan_subscriptions
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_customer_id text;

create table public.gym_stripe_customers (
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id  text not null,
  created_at          timestamptz not null default now(),
  primary key (gym_id, profile_id)
);

-- RLS on, no policies → service role only (the edge functions). Clients
-- have no reason to read the customer mapping.
alter table public.gym_stripe_customers enable row level security;

commit;
