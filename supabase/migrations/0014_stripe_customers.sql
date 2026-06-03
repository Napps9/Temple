-- Phase 1 / Track A: per-gym Stripe Customer mirror.
--
-- A member at two gyms has two Stripe Customer IDs — one on each
-- gym's Connect account — because Connect accounts can't share
-- Customers. The PK is therefore (gym_id, profile_id), not profile_id
-- alone.
--
-- default_payment_method_id tracks the card the member updates via
-- §3.6 "change card details" so the next renewal uses it without a
-- new Subscription.

create table public.stripe_customers (
  gym_id                     uuid not null references public.gyms(id) on delete cascade,
  profile_id                 uuid not null references public.profiles(id) on delete cascade,
  customer_id                text not null,
  default_payment_method_id  text,
  last_synced_at             timestamptz,
  created_at                 timestamptz not null default now(),
  primary key (gym_id, profile_id),
  -- The same Stripe Customer cannot belong to two members at the
  -- same gym. Across gyms the same customer_id can't repeat either —
  -- Stripe Customers are Connect-account-scoped.
  unique (gym_id, customer_id)
);

create index stripe_customers_profile_id_idx on public.stripe_customers(profile_id);

-- The (gym, profile) → membership invariant: a stripe_customers row
-- must point at a real gym_memberships relationship. Webhook / RPC
-- callers create the membership row first, then the customer row.
alter table public.stripe_customers
  add constraint stripe_customers_membership_fk
    foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.stripe_customers enable row level security;

-- Members read their own customer record (one per gym).
create policy stripe_customers_self_select on public.stripe_customers
  for select using (profile_id = auth.uid());

-- Owners read everything in their gym for billing reconciliation.
create policy stripe_customers_owner_select on public.stripe_customers
  for select using (public.user_is_owner_of(gym_id));

-- No insert/update/delete policies: writes are service-role only
-- (signup_member RPC and webhook handlers).
