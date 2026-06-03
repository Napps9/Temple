-- Phase 0.6 dependency: billing_events table shell.
--
-- has_ever_paid (§0.6) reads this table, so the shell lands in
-- Phase 0 even though the Stripe webhook handlers that populate it
-- live in Phase 3 (§3.2). Empty-table behaviour in Phase 0–2:
-- has_ever_paid returns false for everyone, which is correct — no
-- charges have cleared through Temple yet.
--
-- FK behaviour (plan §3.1):
--   - plan_subscription_id → plan_subscriptions(id) is ON DELETE
--     SET NULL: subs are hard-deleted on erasure, but the financial
--     record must survive.
--   - member_id → profiles(id) is NOT NULL: §4.2 anonymises profiles
--     and keeps profiles.id as a tombstone, so member_id continues
--     to resolve (to "Deleted Member #N") after erasure.
--   - gym_id → gyms(id) is nullable: platform events (non-member
--     platform subs, §3.5) carry no gym.
--
-- The payload jsonb is scrubbed by the erasure job (§4.2);
-- billing_events themselves are retained ~6 years (UK statutory).

create table public.billing_events (
  provider              text        not null default 'stripe',
  provider_event_id     text        not null,
  provider_account_id   text,
  gym_id                uuid        references public.gyms(id) on delete set null,
  plan_subscription_id  uuid        references public.plan_subscriptions(id) on delete set null,
  member_id             uuid        not null references public.profiles(id),
  kind                  text        not null,
  amount_cents          integer     not null,
  currency              text        not null,
  occurred_at           timestamptz not null,
  payload               jsonb       not null,
  primary key (provider, provider_event_id),
  check ((provider_account_id is null) = (gym_id is null))
);

create index billing_events_member_gym_idx
  on public.billing_events(member_id, gym_id);
create index billing_events_plan_sub_idx
  on public.billing_events(plan_subscription_id);
create index billing_events_occurred_at_idx
  on public.billing_events(occurred_at);

-- RLS: members read own; staff (Owner/Coach/Staff) read all for
-- their gym; writes are service-role only (webhook handlers
-- bypass RLS).
alter table public.billing_events enable row level security;

create policy billing_events_self_select on public.billing_events
  for select using (member_id = auth.uid());

create policy billing_events_staff_select on public.billing_events
  for select using (
    gym_id is not null
    and public.user_can_assign_plan(gym_id)
  );
