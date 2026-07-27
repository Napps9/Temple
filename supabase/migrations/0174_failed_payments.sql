-- Failed membership payments: see them, chase them, stop counting them.
--
-- Until now Temple could not see a bounced card at all. stripe-webhook
-- handled checkout.session.completed, invoice.paid,
-- customer.subscription.updated (store subs only) and
-- customer.subscription.deleted — no failure event anywhere. A member
-- whose payment failed stayed 'active' with a stale paid_period_end until
-- Stripe eventually gave up and deleted the subscription, which can be a
-- month later. Nobody was told, and the money sat inside the Money
-- block's Pending figure looking healthy (0173).
--
-- WHY COLUMNS AND NOT A 'past_due' STATE. The obvious move is another
-- plan_sub_state value. Two things rule it out:
--
--   1. `ps.status = 'active'` is what gates booking eligibility —
--      0011_eligibility_predicates.sql:82,174,274 and
--      0050_multi_membership_booking.sql:120,284. Flipping a member to
--      past_due would bar them from booking the moment their card
--      bounced, before Stripe has retried once. Stripe's smart retries
--      run for about two weeks and most of them recover. Locking someone
--      out of training on day one over a card that expired is a worse
--      product than not knowing at all.
--   2. A new enum value cannot be USED in the transaction that adds it,
--      and every migration here is wrapped in begin/commit.
--
-- So the membership stays 'active' — the grace period falls out for free
-- and none of the ~55 status reads across the schema change behaviour —
-- and the dunning state rides alongside on its own columns. That is the
-- same shape store_subscriptions already has, except store subs got a
-- real status because nothing gates entry on one.
--
-- Sections:
--   1. dunning columns + chase index
--   2. membership_invoice_links — somewhere for the member to pay
--   3. _record_payment_failure — the write path, guards and all
--   4. _clear_payment_failure  — recovery, all-or-nothing
--   5. gym_overdue_memberships — the chase list
--   6. compute_finance_summary — split at-risk out of pending

begin;

-- ============================================================================
-- 1. Dunning state
-- ============================================================================
--
-- past_due_since is the start of the CURRENT run of failures, not the
-- last one: it is set on the first failure and left alone by subsequent
-- ones, so "how long has this been broken" survives Stripe's retries.
-- Cleared on recovery, which is what makes it the whole flag.
--
-- next_payment_attempt is Stripe's own schedule (invoice.next_payment_
-- attempt). Null with a live past_due_since means Stripe has stopped
-- retrying — the subscription is about to be cancelled and the chase is
-- now urgent rather than routine.
--
-- The Stripe-hosted invoice link does NOT live here — see section 2. It
-- would be read by anyone plan_subscriptions' staff policy admits, and
-- that is owner/coach/staff (user_can_assign_plan, 0008:34), who do not
-- hold can_see_full_pii.

alter table public.plan_subscriptions
  add column past_due_since        timestamptz,
  add column payment_failure_count integer not null default 0,
  add column last_payment_error    text,
  add column next_payment_attempt  timestamptz;

-- The chase list's lookup path. Partial so the index stays tiny — a
-- healthy gym has no rows in it at all.
create index plan_subscriptions_past_due_idx
  on public.plan_subscriptions(gym_id, past_due_since)
  where past_due_since is not null;

-- ============================================================================
-- 2. membership_invoice_links
-- ============================================================================
--
-- Temple has no billing portal and no card-update screen, so a member told
-- their payment failed has nowhere to pay. Stripe's hosted invoice page
-- fixes that with no extra setup — it takes a new card against the open
-- invoice — and turns a two-week retry wait into a same-day recovery.
--
-- It gets its own table because it is a BEARER link: anyone holding the
-- URL can load a page rendering the member's billing name and address.
-- plan_subscriptions is the obvious home and the wrong one — its staff
-- select policy is user_can_assign_plan (0008:189), which admits
-- owner/coach/staff, and coach/staff deliberately do not hold
-- can_see_full_pii or can_see_email. Putting the URL on that row would
-- hand every coach a link to every member's billing address.
--
-- So: the member reads their own, and nobody else reads it at all. Staff
-- chasing a payment do not need the link — they need the name and the
-- amount, which is what gym_overdue_memberships gives them.

create table public.membership_invoice_links (
  plan_subscription_id uuid primary key
    references public.plan_subscriptions(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  invoice_url text not null,
  updated_at  timestamptz not null default now()
);

alter table public.membership_invoice_links enable row level security;

-- Self only, deliberately. No staff policy, no admin policy: see above.
create policy membership_invoice_links_self_select
  on public.membership_invoice_links
  for select using (profile_id = auth.uid());

-- ============================================================================
-- 3. _record_payment_failure
-- ============================================================================
--
-- The webhook could write these columns directly, and the first draft did.
-- Three things need a SQL expression rather than a PostgREST update, and
-- every one of them is a real failure mode rather than tidiness:
--
--   * Stripe does not guarantee webhook ORDER. Writing attempt_count
--     straight through lets attempt 3 arrive before attempt 2 and walk the
--     counter backwards. greatest() makes it monotonic.
--   * Reading past_due_since and then writing it back is a read-then-write
--     race: two redeliveries in flight can both see null and both stamp,
--     losing the original failure time. coalesce() in the UPDATE is atomic.
--   * A cancelled or lapsed membership is not in dunning, it is dead —
--     and Stripe keeps retrying an open invoice after cancellation, so
--     without a status guard a dead row gets re-flagged and reappears on
--     the chase list.
--
-- billing_reason is filtered here rather than in the webhook so it is
-- testable: only subscription-driven invoices are membership dunning. A
-- gym raising a manual invoice, or a usage-threshold charge, must not mark
-- a healthy member as failing.
--
-- Follows _mark_store_order_paid (0085) — a definer RPC the webhook calls
-- under the service role.

create or replace function public._record_payment_failure(
  p_stripe_subscription_id text,
  p_attempt                integer,
  p_error                  text,
  p_invoice_url            text,
  p_next_attempt           timestamptz,
  p_billing_reason         text,
  p_invoice_period_end     timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps public.plan_subscriptions;
begin
  if coalesce(p_billing_reason, 'subscription_cycle') not in
     ('subscription_cycle', 'subscription_create', 'subscription_update') then
    return false;
  end if;

  select * into v_ps
    from public.plan_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id;
  if v_ps.id is null then
    return false;
  end if;
  if v_ps.status in ('lapsed'::public.plan_sub_state,
                     'cancelled'::public.plan_sub_state) then
    return false;
  end if;

  -- The period this invoice covers is already paid for. Stripe redelivers
  -- on any 5xx and does not guarantee order, so a payment_failed can
  -- legitimately arrive AFTER the retry that settled it. Without this the
  -- member gets a red "we couldn't take your payment" banner and lands
  -- back on the chase list, for up to a month, having paid.
  if v_ps.paid_period_end is not null
     and p_invoice_period_end is not null
     and v_ps.paid_period_end >= p_invoice_period_end then
    return false;
  end if;

  update public.plan_subscriptions
    set past_due_since        = coalesce(past_due_since, now()),
        payment_failure_count = greatest(payment_failure_count,
                                         coalesce(p_attempt, 1)),
        last_payment_error    = p_error,
        -- Only the newest attempt gets to move the retry date; an
        -- out-of-order older event must not rewind it.
        next_payment_attempt  = case
          when coalesce(p_attempt, 1) >= payment_failure_count
          then p_next_attempt
          else next_payment_attempt
        end
    where id = v_ps.id;

  if p_invoice_url is not null then
    insert into public.membership_invoice_links
      (plan_subscription_id, profile_id, gym_id, invoice_url)
    values (v_ps.id, v_ps.profile_id, v_ps.gym_id, p_invoice_url)
    on conflict (plan_subscription_id) do update
      set invoice_url = excluded.invoice_url, updated_at = now();
  end if;

  return true;
end;
$$;

revoke execute on function public._record_payment_failure(
  text, integer, text, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;

-- ============================================================================
-- 4. _clear_payment_failure
-- ============================================================================
--
-- Recovery, in one place because it has to be all-or-nothing: a member
-- left with a stale "Pay now" button after their payment went through is
-- worse than one who was never told. Called from invoice.paid and from a
-- membership subscription going back to active.

create or replace function public._clear_payment_failure(
  p_stripe_subscription_id text,
  p_event_time             timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Ordering guard, the mirror of the one on the write path. Stripe emits
  -- customer.subscription.updated{status:active} as the period advances,
  -- moments before the invoice for that period fails — so an out-of-order
  -- or redelivered copy of that event can arrive after a genuine failure
  -- and wipe it. Only a clearing event NEWER than the failure clears.
  update public.plan_subscriptions
    set past_due_since        = null,
        payment_failure_count = 0,
        last_payment_error    = null,
        next_payment_attempt  = null
    where stripe_subscription_id = p_stripe_subscription_id
      and past_due_since is not null
      and (p_event_time is null or past_due_since <= p_event_time)
    returning id into v_id;

  if v_id is not null then
    delete from public.membership_invoice_links where plan_subscription_id = v_id;
  end if;
end;
$$;

revoke execute on function public._clear_payment_failure(text, timestamptz)
  from public, anon, authenticated;

-- ============================================================================
-- 5. gym_overdue_memberships
-- ============================================================================
--
-- Deliberately returns no email, no phone, and no invoice link.
-- Chasing needs to know WHO; contact details are governed by
-- can_see_email / can_see_full_pii, and the hosted invoice link is a
-- bearer URL rendering the member's own billing details. Routing either
-- through a money RPC would quietly bypass those gates. The list
-- deep-links to the member, where PII is already gated correctly.

create or replace function public.gym_overdue_memberships(p_gym_id uuid)
returns table (
  subscription_id       uuid,
  profile_id            uuid,
  full_name             text,
  plan_name             text,
  amount_cents          integer,
  currency              text,
  past_due_since        timestamptz,
  payment_failure_count integer,
  next_payment_attempt  timestamptz,
  last_payment_error    text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_money') then
    raise exception 'Not authorised';
  end if;

  return query
  select
    ps.id,
    ps.profile_id,
    p.full_name,
    mp.name,
    coalesce(ps.price_cents, mp.monthly_price_cents),
    g.currency,
    ps.past_due_since,
    ps.payment_failure_count,
    ps.next_payment_attempt,
    ps.last_payment_error
  from public.plan_subscriptions ps
  join public.membership_plans mp on mp.plan_id = ps.plan_id
  join public.profiles p          on p.id       = ps.profile_id
  join public.gyms g              on g.id       = ps.gym_id
  where ps.gym_id = p_gym_id
    and ps.past_due_since is not null
    -- A cancelled membership is not worth chasing; the money is gone and
    -- the row only still carries dunning state as history.
    and ps.status in ('active'::public.plan_sub_state,
                      'cancelled_at_period_end'::public.plan_sub_state,
                      'refunded_retained'::public.plan_sub_state)
  order by ps.past_due_since;
end;
$$;

grant execute on function public.gym_overdue_memberships(uuid) to authenticated;

-- ============================================================================
-- 6. compute_finance_summary — pending splits
-- ============================================================================
--
-- 0173 shipped Pending as "renewals Stripe will attempt before the month
-- is out" and said in its own header that a bounced card sits inside it
-- looking healthy. Now that the bounce is visible, it comes out:
--
--   pending  — scheduled and healthy
--   at_risk  — scheduled but already failing
--
-- They stay separate rather than netted, because an owner needs both
-- numbers: what is coming, and what is coming only if someone picks up
-- the phone. Month projected keeps using pending alone — counting money
-- from a card that has already been declined is how a forecast lies.
--
-- RETURNS TABLE gains columns, and CREATE OR REPLACE cannot change a
-- function's return shape (0043).

drop function if exists public.compute_finance_summary(uuid, date);

create function public.compute_finance_summary(
  p_gym_id      uuid,
  p_month_start date
) returns table (
  currency          text,
  confirmed_cents   bigint,
  confirmed_count   integer,
  pending_cents     bigint,
  pending_count     integer,
  at_risk_cents     bigint,
  at_risk_count     integer,
  forward_mrr_cents bigint,
  forward_count     integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_month_end timestamptz;
  v_gym_ccy   text;
begin
  if not public.effective_can(p_gym_id, 'can_see_money') then
    raise exception 'Not authorised';
  end if;
  if p_month_start is null then
    raise exception 'Pick a month';
  end if;

  select g.currency into v_gym_ccy from public.gyms g where g.id = p_gym_id;
  if v_gym_ccy is null then
    raise exception 'Gym not found';
  end if;

  v_month_end := (p_month_start + interval '1 month')::timestamptz;

  return query
  with confirmed as (
    select be.currency as ccy,
           sum(be.amount_cents)::bigint as cents,
           count(*)::int as n
    from public.billing_events be
    where be.gym_id = p_gym_id
      and public.is_revenue_event(be.provider, be.kind)
      and be.occurred_at >= p_month_start::timestamptz
      and be.occurred_at <  v_month_end
    group by be.currency
  ),
  live as (
    select coalesce(ps.price_cents, mp.monthly_price_cents) as cents,
           ps.paid_period_end,
           ps.past_due_since
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    where ps.gym_id = p_gym_id
      and ps.status in ('active'::public.plan_sub_state,
                        'cancelled_at_period_end'::public.plan_sub_state,
                        'refunded_retained'::public.plan_sub_state)
      and mp.kind <> 'credit_pack'
  ),
  agg as (
    select
      coalesce(sum(cents), 0)::bigint as fwd_cents,
      count(*)::int                   as fwd_n,
      coalesce(sum(cents) filter (where due and not failing), 0)::bigint as pend_cents,
      (count(*) filter (where due and not failing))::int                 as pend_n,
      coalesce(sum(cents) filter (where failing), 0)::bigint             as risk_cents,
      (count(*) filter (where failing))::int                             as risk_n
    from (
      select cents,
             past_due_since is not null as failing,
             paid_period_end is not null
               and paid_period_end > now()
               and paid_period_end < v_month_end as due
      from live
    ) l
  ),
  ccy as (
    select c.ccy from confirmed c
    union
    select v_gym_ccy
  )
  select
    ccy.ccy,
    coalesce(c.cents, 0)::bigint,
    coalesce(c.n, 0),
    case when ccy.ccy = v_gym_ccy then a.pend_cents else 0::bigint end,
    case when ccy.ccy = v_gym_ccy then a.pend_n     else 0 end,
    case when ccy.ccy = v_gym_ccy then a.risk_cents else 0::bigint end,
    case when ccy.ccy = v_gym_ccy then a.risk_n     else 0 end,
    case when ccy.ccy = v_gym_ccy then a.fwd_cents  else 0::bigint end,
    case when ccy.ccy = v_gym_ccy then a.fwd_n      else 0 end
  from ccy
  cross join agg a
  left join confirmed c on c.ccy = ccy.ccy
  order by 2 desc;
end;
$$;

grant execute on function public.compute_finance_summary(uuid, date) to authenticated;

commit;
