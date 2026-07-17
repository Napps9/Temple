-- One Temple plan per Stripe price per gym.
--
-- The Stripe importer could create a second copy of a plan when the
-- import was re-run (e.g. after the plans-only path errored on a gym
-- with no subscribers). The client now reuses an existing plan for a
-- price, but that's not a guarantee — a race or an older client could
-- still double-insert. A partial unique index makes duplicates
-- impossible at the source of truth.
--
-- Scope: (gym_id, stripe_price_id) among non-archived rows only. A
-- manually-created plan (null stripe_price_id) is unconstrained, and an
-- archived plan doesn't block importing a fresh one for the same price.
--
-- Existing duplicates must be resolved before the index can be built.
-- We keep one active plan per (gym, price) — preferring the one with the
-- most subscriptions, then the earliest created — and archive the rest.
-- Archiving (not deleting) preserves any plan_subscriptions on the losing
-- rows: existing subscribers keep their plan, it's just no longer offered.

begin;

with sub_counts as (
  select plan_id, count(*) as n
  from public.plan_subscriptions
  group by plan_id
),
ranked as (
  select mp.plan_id,
         row_number() over (
           partition by mp.gym_id, mp.stripe_price_id
           order by coalesce(sc.n, 0) desc, mp.created_at, mp.plan_id
         ) as rn
  from public.membership_plans mp
  left join sub_counts sc on sc.plan_id = mp.plan_id
  where mp.stripe_price_id is not null
    and mp.archived_at is null
)
update public.membership_plans mp
  set archived_at = now()
  from ranked
  where mp.plan_id = ranked.plan_id
    and ranked.rn > 1;

create unique index if not exists membership_plans_gym_stripe_price_unique
  on public.membership_plans (gym_id, stripe_price_id)
  where stripe_price_id is not null and archived_at is null;

commit;
