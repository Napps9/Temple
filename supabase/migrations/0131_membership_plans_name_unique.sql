-- One active Temple plan per name per gym.
--
-- 0130 stopped duplicate plans that share a Stripe price. Two *different*
-- Stripe prices (or manual plans) that share a name still slipped through
-- and read as duplicates to the owner — e.g. two "1 Class Pass" cards. A
-- name is what members see, so uniqueness is enforced on it too:
-- case-insensitive and whitespace-trimmed, among non-archived rows.
--
-- Existing collisions are resolved before the index builds. We keep one
-- active plan per (gym, normalised name) — the one with the most
-- subscriptions, then the earliest created — and archive the rest, which
-- preserves any subscriptions on the losing rows.

begin;

with sub_counts as (
  select plan_id, count(*) as n
  from public.plan_subscriptions
  group by plan_id
),
ranked as (
  select mp.plan_id,
         row_number() over (
           partition by mp.gym_id, lower(btrim(mp.name))
           order by coalesce(sc.n, 0) desc, mp.created_at, mp.plan_id
         ) as rn
  from public.membership_plans mp
  left join sub_counts sc on sc.plan_id = mp.plan_id
  where mp.archived_at is null
)
update public.membership_plans mp
  set archived_at = now()
  from ranked
  where mp.plan_id = ranked.plan_id
    and ranked.rn > 1;

create unique index if not exists membership_plans_gym_name_unique
  on public.membership_plans (gym_id, lower(btrim(name)))
  where archived_at is null;

commit;
