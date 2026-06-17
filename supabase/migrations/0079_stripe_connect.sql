-- Stripe Connect (Standard) — Phase 1: a gym connects its own Stripe
-- account via OAuth so it can charge its members directly. We store the
-- connected account id here; charges / subscriptions / webhooks land in
-- later phases. No platform application fee — the gym keeps 100%.
--
-- Two tables:
--   gym_stripe_accounts  — one row per connected gym (the acct_… id).
--                          Owners can read their own; writes happen only
--                          from the connect-callback edge function
--                          (service role), so there are no client
--                          insert/update/delete policies.
--   stripe_oauth_states  — short-lived CSRF tokens for the OAuth round
--                          trip, written + read only by the edge
--                          functions (service role). RLS on, no policies
--                          → locked to the service role.

begin;

create table public.gym_stripe_accounts (
  gym_id             uuid primary key references public.gyms(id) on delete cascade,
  stripe_account_id  text not null,
  connected_by       uuid references public.profiles(id) on delete set null,
  connected_at       timestamptz not null default now()
);

alter table public.gym_stripe_accounts enable row level security;

create policy gym_stripe_accounts_select on public.gym_stripe_accounts
  for select using (public.user_is_owner_of(gym_id));

create table public.stripe_oauth_states (
  state        text primary key,
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  origin       text not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.stripe_oauth_states enable row level security;

commit;
