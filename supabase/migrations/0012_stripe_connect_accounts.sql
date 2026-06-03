-- Phase 1 / Track A: Stripe Connect account per gym.
--
-- Each gym onboards its own Stripe Connect account; Temple operates
-- the platform account separately (used by §5.4 non-member tracking
-- subscriptions only — see Track F). All §3 billing — signups,
-- subscriptions, charges, refunds — flows through the gym's Connect
-- account, not the platform account.
--
-- This table is the local mirror of Stripe's account state. Webhook
-- handlers update charges_enabled / payouts_enabled / details_submitted
-- on account.updated; create_stripe_connect_link / refresh_stripe_account
-- RPCs (deferred to the Stripe SDK wiring step) read and write here.

-- ============================================================================
-- 1. onboarding_status enum
-- ============================================================================

create type public.connect_onboarding_status as enum (
  'not_started',
  'in_progress',
  'completed',
  'rejected'
);

-- ============================================================================
-- 2. stripe_connect_accounts table (one row per gym)
-- ============================================================================

create table public.stripe_connect_accounts (
  gym_id              uuid primary key references public.gyms(id) on delete cascade,
  provider            text not null default 'stripe',
  provider_account_id text unique,
  onboarding_status   public.connect_onboarding_status not null default 'not_started',
  charges_enabled     boolean not null default false,
  payouts_enabled     boolean not null default false,
  details_submitted   boolean not null default false,
  country             text,
  default_currency    text,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now()
);

-- ============================================================================
-- 3. RLS — Owner-only read; writes happen via service-role from the
--    onboarding edge function + webhook handler.
-- ============================================================================

alter table public.stripe_connect_accounts enable row level security;

create policy stripe_connect_accounts_owner_select on public.stripe_connect_accounts
  for select using (public.user_is_owner_of(gym_id));

-- No insert/update/delete policies: provisioning is service-role only.
-- Owners interact via RPCs, not direct DML.
