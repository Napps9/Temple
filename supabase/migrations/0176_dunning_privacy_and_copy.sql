-- Failed-payment follow-ups: put the dunning state behind can_see_money,
-- stop telling credit members something untrue, and let the data expire.
--
-- Three defects in 0174/0175, found by re-running the privacy and UX review
-- lenses that had died mid-review.
--
-- 1. THE DECLINE REASON WAS READABLE BY EVERY COACH. 0174 reasoned that the
--    hosted-invoice URL was too sensitive for plan_subscriptions, because
--    that table's staff policy is user_can_assign_plan (0008:189) —
--    owner/admin/coach/staff, no capability term — and gave the URL its own
--    table. It then put past_due_since, payment_failure_count,
--    last_payment_error and next_payment_attempt on the row it had just
--    called unsafe. can_see_money is false for every non-owner role by
--    default (0025:31), so the gate on gym_overdue_memberships was
--    decorative: any coach could select the whole chase list — who is
--    failing, since when, and Stripe's verbatim decline text — straight off
--    plan_subscriptions via PostgREST. payment_notifications_rls.sql asserts
--    a coach sees none of this; the assertion was true of one table and
--    false of the one next to it.
--
--    Postgres has no column-level RLS, so the only structural fix is a side
--    table with its own policy — the shape 0174 used for the invoice link.
--
-- 2. "YOUR CLASSES ARE NOT AFFECTED" IS FALSE ON A CREDIT PLAN. Booking
--    needs status = 'active' AND (kind = 'unlimited' OR credit_balance > 0)
--    (0011:92, 0050:130), and credit_balance is only refilled by
--    invoice.paid (stripe-webhook:749). A credit_period member who spends
--    their last credit and then has the renewal fail cannot book anything
--    for the fortnight — while the email, the in-app notice and the chase
--    list all tell them, and their gym, that they can.
--
-- 3. THE DATA NEVER EXPIRED. leave_gym cancels the subscription and erases
--    health data but left the dunning row, the notifications, and a live
--    bearer link to a Stripe page rendering the member's billing address.
--    The only delete path was recovery, and a member who quits instead of
--    paying never recovers. Their PAR-Q was destroyed on the way out; the
--    record that their card was declined was kept for good.
--
-- Sections:
--   1. plan_subscription_dunning — the state, behind can_see_money
--   2. _record_payment_failure / _clear_payment_failure against it
--   3. _enqueue_payment_notice — plan-kind-aware copy
--   4. gym_overdue_memberships — join the side table, expose notice state
--   5. compute_finance_summary — same join
--   6. leave_gym — erase on the way out
--   7. purge_expired_payment_data + retry budget

begin;

-- ============================================================================
-- 1. plan_subscription_dunning
-- ============================================================================
--
-- A row exists only while a membership is in a run of failures, so presence
-- IS past-due and recovery is a delete. That is a stronger invariant than
-- 0174's nullable columns, where "cleared" meant four fields agreeing.

create table public.plan_subscription_dunning (
  plan_subscription_id  uuid primary key
    references public.plan_subscriptions(id) on delete cascade,
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  gym_id                uuid not null references public.gyms(id) on delete cascade,
  past_due_since        timestamptz not null default now(),
  payment_failure_count integer not null default 0,
  last_payment_error    text,
  next_payment_attempt  timestamptz,
  updated_at            timestamptz not null default now()
);

create index plan_subscription_dunning_gym_idx
  on public.plan_subscription_dunning(gym_id, past_due_since);

alter table public.plan_subscription_dunning enable row level security;

-- The member, and staff who can see money. NOT user_can_assign_plan: that
-- is the whole point of moving these columns here.
create policy plan_subscription_dunning_select
  on public.plan_subscription_dunning
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_money')
  );

insert into public.plan_subscription_dunning
  (plan_subscription_id, profile_id, gym_id, past_due_since,
   payment_failure_count, last_payment_error, next_payment_attempt)
select id, profile_id, gym_id, past_due_since,
       payment_failure_count, last_payment_error, next_payment_attempt
  from public.plan_subscriptions
  where past_due_since is not null;

drop index if exists public.plan_subscriptions_past_due_idx;

alter table public.plan_subscriptions
  drop column past_due_since,
  drop column payment_failure_count,
  drop column last_payment_error,
  drop column next_payment_attempt;

-- ============================================================================
-- 2. The write paths
-- ============================================================================
--
-- Guards are 0174's verbatim; only the target table changes. The
-- monotonicity and ordering reasoning still applies — Stripe does not
-- guarantee webhook order — it just applies to the side table now.

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
  v_ps   public.plan_subscriptions;
  v_next timestamptz;
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

  if v_ps.paid_period_end is not null
     and p_invoice_period_end is not null
     and v_ps.paid_period_end >= p_invoice_period_end then
    return false;
  end if;

  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, payment_failure_count,
     last_payment_error, next_payment_attempt)
  values (v_ps.id, v_ps.profile_id, v_ps.gym_id, coalesce(p_attempt, 1),
     p_error, p_next_attempt)
  on conflict (plan_subscription_id) do update
    set payment_failure_count = greatest(
          public.plan_subscription_dunning.payment_failure_count,
          coalesce(p_attempt, 1)),
        last_payment_error    = excluded.last_payment_error,
        next_payment_attempt  = case
          when coalesce(p_attempt, 1)
               >= public.plan_subscription_dunning.payment_failure_count
          then excluded.next_payment_attempt
          else public.plan_subscription_dunning.next_payment_attempt
        end,
        updated_at = now()
  returning next_payment_attempt into v_next;

  if p_invoice_url is not null then
    insert into public.membership_invoice_links
      (plan_subscription_id, profile_id, gym_id, invoice_url)
    values (v_ps.id, v_ps.profile_id, v_ps.gym_id, p_invoice_url)
    on conflict (plan_subscription_id) do update
      set invoice_url = excluded.invoice_url, updated_at = now();
  end if;

  if v_next is null then
    perform public._enqueue_payment_notice(v_ps.id, 'payment_final_notice');
  else
    perform public._enqueue_payment_notice(v_ps.id, 'payment_failed');
  end if;

  return true;
end;
$$;

revoke execute on function public._record_payment_failure(
  text, integer, text, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;

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
  delete from public.plan_subscription_dunning d
    using public.plan_subscriptions ps
    where ps.id = d.plan_subscription_id
      and ps.stripe_subscription_id = p_stripe_subscription_id
      and (p_event_time is null or d.past_due_since <= p_event_time)
    returning d.plan_subscription_id into v_id;

  if v_id is not null then
    delete from public.membership_invoice_links where plan_subscription_id = v_id;

    update public.payment_notifications
      set status = 'skipped',
          error  = 'Payment recovered before the email went out'
      where plan_subscription_id = v_id
        and channel = 'email'
        and status in ('queued', 'failed');

    update public.payment_notifications
      set read_at = now(), status = 'read'
      where plan_subscription_id = v_id
        and channel = 'in_app'
        and read_at is null;
  end if;
end;
$$;

revoke execute on function public._clear_payment_failure(text, timestamptz)
  from public, anon, authenticated;

-- ============================================================================
-- 3. _enqueue_payment_notice — say the true thing per plan kind
-- ============================================================================

create or replace function public._enqueue_payment_notice(
  p_subscription_id uuid,
  p_kind            text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps         public.plan_subscriptions;
  v_dun        public.plan_subscription_dunning;
  v_unlimited  boolean;
  v_gym        text;
  v_tz         text;
  v_email      text;
  v_body       text;
  v_body_email text;
  v_key        text;
  v_count      integer;
begin
  select * into v_ps from public.plan_subscriptions where id = p_subscription_id;
  if v_ps.id is null then
    return 0;
  end if;

  select * into v_dun from public.plan_subscription_dunning
    where plan_subscription_id = p_subscription_id;
  if v_dun.plan_subscription_id is null then
    return 0;
  end if;

  select mp.kind = 'unlimited' into v_unlimited
    from public.membership_plans mp where mp.plan_id = v_ps.plan_id;

  -- gyms.timezone is free text with no CHECK. This function runs inside the
  -- failure transaction: a raise here rolls back the dunning row and 500s
  -- the Stripe webhook, which then retries into the same failure forever.
  select g.name,
         case when exists (select 1 from pg_timezone_names t
                           where t.name = g.timezone)
              then g.timezone else 'UTC' end
    into v_gym, v_tz
    from public.gyms g where g.id = v_ps.gym_id;
  select u.email into v_email from auth.users u where u.id = v_ps.profile_id;

  v_key := p_kind || ':' || p_subscription_id || ':'
           || extract(epoch from v_dun.past_due_since)::bigint;

  if p_kind = 'payment_final_notice' then
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym')
      || ', and we have stopped trying. Your membership will be cancelled '
      || 'unless it is paid.';
    v_body_email := v_body;
  else
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym') || '. '
      -- Only unlimited members can keep booking through a failure. Credit
      -- plans are topped up by invoice.paid and by nothing else, so a
      -- member who has spent this month's credits is locked out until the
      -- payment goes through — telling them otherwise sends them to a
      -- booking screen that refuses every class.
      || case when v_unlimited
              then 'Your classes are not affected — you can keep booking — '
                   || 'and we will try again'
              else 'This month''s class credits have not been added yet, so '
                   || 'you cannot book until it is paid. We will try again'
         end;
    -- The email is read the day it lands, so naming the retry date helps.
    -- The in-app row is read live, days later, off a body frozen at write
    -- time — a stored date there is usually already in the past.
    v_body_email := v_body
      -- In the GYM's timezone, not the server's. A retry at 23:30 UTC is the
      -- following day for a gym in Sydney.
      || case when v_dun.next_payment_attempt is null then ''
              else ' on ' || to_char(
                v_dun.next_payment_attempt at time zone v_tz, 'FMDD Mon') end
      || '. Paying now saves the wait.';
    v_body := v_body || ' soon. Paying now saves the wait.';
  end if;

  insert into public.payment_notifications
    (gym_id, plan_subscription_id, recipient_profile_id, kind, channel,
     recipient, body, status, sent_at, error, idempotency_key)
  select
    v_ps.gym_id, v_ps.id, v_ps.profile_id, p_kind, c.channel,
    -- NOT the member's email address. can_see_money staff can read these
    -- rows and can_see_email is a separate capability.
    case when c.channel = 'in_app' then v_ps.profile_id::text end,
    case when c.channel = 'in_app' then v_body else v_body_email end,
    case
      when c.channel = 'in_app' then 'sent'
      when v_email is null then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case when c.channel = 'email' and v_email is null
         then 'Member has no email address' end,
    c.channel || ':' || v_key
  from (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0) / 2;
end;
$$;

revoke execute on function public._enqueue_payment_notice(uuid, text)
  from public, anon, authenticated;

-- ============================================================================
-- 4. gym_overdue_memberships
-- ============================================================================
--
-- Gains notice_status: whether the member has actually been told. An owner
-- about to phone someone needs to know the difference between "we emailed
-- them and they ignored it" and "we never emailed them", and the queue can
-- stall — a worker invoke that times out leaves the row queued.
--
-- RETURNS TABLE gains a column (0043).

drop function if exists public.gym_overdue_memberships(uuid);

create function public.gym_overdue_memberships(p_gym_id uuid)
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
  last_payment_error    text,
  notice_status         text
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
    d.past_due_since,
    d.payment_failure_count,
    d.next_payment_attempt,
    d.last_payment_error,
    (select n.status from public.payment_notifications n
      where n.plan_subscription_id = ps.id and n.channel = 'email'
      order by n.created_at desc limit 1)
  from public.plan_subscription_dunning d
  join public.plan_subscriptions ps on ps.id = d.plan_subscription_id
  join public.membership_plans mp   on mp.plan_id = ps.plan_id
  join public.profiles p            on p.id       = ps.profile_id
  join public.gyms g                on g.id       = ps.gym_id
  where d.gym_id = p_gym_id
    and ps.status in ('active'::public.plan_sub_state,
                      'cancelled_at_period_end'::public.plan_sub_state,
                      'refunded_retained'::public.plan_sub_state)
  order by d.past_due_since;
end;
$$;

grant execute on function public.gym_overdue_memberships(uuid) to authenticated;

-- ============================================================================
-- 5. compute_finance_summary — same split, new source
-- ============================================================================

create or replace function public.compute_finance_summary(
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
           d.plan_subscription_id as failing_id
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    left join public.plan_subscription_dunning d on d.plan_subscription_id = ps.id
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
             failing_id is not null as failing,
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

-- ============================================================================
-- 6. leave_gym — erase the payment trail on the way out
-- ============================================================================
--
-- Body is 0037's verbatim plus the three deletes. The invoice link is the
-- urgent one: it is a bearer URL to a Stripe page rendering the member's
-- billing name and address, and a member who quits mid-dunning previously
-- left it behind with no path that would ever remove it.

create or replace function public.leave_gym(p_gym_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_profile_id and not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  update public.gym_memberships
    set left_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;

  delete from public.class_bookings
    where profile_id = p_profile_id
      and class_session_id in (
        select id from public.class_sessions
        where gym_id = p_gym_id and starts_at > now()
      );

  update public.plan_subscriptions
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and not public.is_terminal_subscription_status(status);

  update public.comp_grants
    set revoked_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and revoked_at is null;

  delete from public.class_waitlist
    where gym_id = p_gym_id and profile_id = p_profile_id;

  delete from public.membership_invoice_links
    where gym_id = p_gym_id and profile_id = p_profile_id;
  delete from public.plan_subscription_dunning
    where gym_id = p_gym_id and profile_id = p_profile_id;
  delete from public.payment_notifications
    where gym_id = p_gym_id and recipient_profile_id = p_profile_id;

  -- Removal from the membership erases the member's special-category
  -- health data immediately (the "OR after member is removed" half of
  -- the retention rule). Re-joining means re-consenting + re-screening.
  perform public._erase_member_health_data(p_gym_id, p_profile_id, 'erase');
end;
$$;

-- ============================================================================
-- 7. Retention, and a retry budget for the email
-- ============================================================================
--
-- attempts exists because every drain path selects status = 'queued' only,
-- so a row flipped to 'failed' by a provider 429 was terminal — and one
-- notice per dunning run means nothing would ever enqueue a replacement.
-- The worker re-picks failed rows until the budget runs out.

alter table public.payment_notifications
  add column attempts integer not null default 0;

drop index if exists public.payment_notifications_queued_idx;
create index payment_notifications_sendable_idx
  on public.payment_notifications(gym_id, status)
  where channel = 'email' and status in ('queued', 'failed');

-- Mirrors purge_expired_health_data (0037) and purge_expired_waiver_
-- signatures (0108). Two windows, because the two things are different:
-- an invoice link is a live credential and dies with the run that produced
-- it; a notification is a record of what we told someone about their money,
-- which is worth a year and no longer.
create or replace function public.purge_expired_payment_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.membership_invoice_links l
    where not exists (
      select 1 from public.plan_subscription_dunning d
      where d.plan_subscription_id = l.plan_subscription_id
    )
    and l.updated_at < now() - interval '30 days'
    returning l.plan_subscription_id
  )
  select count(*) into v_count from deleted;

  with deleted as (
    delete from public.payment_notifications
    where created_at < now() - interval '1 year'
    returning id
  )
  select v_count + count(*) into v_count from deleted;

  return v_count;
end;
$$;

grant execute on function public.purge_expired_payment_data() to authenticated;

commit;
