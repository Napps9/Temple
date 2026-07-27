-- Tell the member their payment failed.
--
-- 0174 made a bounced card visible: the flags, the chase list, the At risk
-- tile, and a notice with a Pay now button on the Membership screen. What
-- it did not do is TELL anyone. A member who does not open the app finds
-- out when their membership is cancelled, which is the one outcome the
-- whole feature exists to prevent.
--
-- Shape follows cover_notifications (0165) and class_change_notifications
-- (0169): Postgres makes no outbound HTTP, so the in-app notification IS
-- the row we insert (delivered instantly) and the email is enqueued
-- 'queued' for an edge worker.
--
-- ONE NOTICE PER DUNNING RUN, NOT PER RETRY. Stripe attempts a failing
-- card three or four times over about two weeks. Mailing on each would
-- teach the member to ignore the sender by the time it actually matters.
-- The idempotency key carries past_due_since — the start of the run,
-- which 0174 stamps once and leaves alone — so every retry inside a run
-- collapses onto the same key. A genuinely new run has a new
-- past_due_since and does notify.
--
-- The exception is the last one. When Stripe gives up (a failure arriving
-- with no next attempt scheduled) the consequence changes from "we'll try
-- again" to "your membership is about to be cancelled", so that earns its
-- own message under a separate kind.
--
-- RECOVERY UNSENDS WHAT IT CAN. The email is queued, not sent inline, so
-- there is a real window between a member paying and the worker draining.
-- Mailing "your payment failed" to someone who fixed it ten minutes ago is
-- worse than not mailing at all, so _clear_payment_failure marks anything
-- still queued as skipped and marks the in-app rows read — otherwise a
-- recovered member keeps an unread badge for a notice that no longer
-- applies.
--
-- Sections:
--   1. payment_notifications table + RLS
--   2. _enqueue_payment_notice
--   3. _record_payment_failure  — enqueue on the first failure of a run
--   4. _clear_payment_failure   — unsend and mark read on recovery
--   5. read surface + inbox rollup

begin;

-- ============================================================================
-- 1. payment_notifications
-- ============================================================================

create table public.payment_notifications (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  plan_subscription_id uuid not null
    references public.plan_subscriptions(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  kind                 text not null
    check (kind in ('payment_failed', 'payment_final_notice')),
  channel              text not null check (channel in ('email', 'in_app')),
  recipient            text,
  body                 text not null,
  status               text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  error                text,
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  read_at              timestamptz
);

create index payment_notifications_recipient_unread_idx
  on public.payment_notifications(gym_id, recipient_profile_id)
  where channel = 'in_app' and read_at is null;

create index payment_notifications_queued_idx
  on public.payment_notifications(gym_id, status)
  where channel = 'email' and status = 'queued';

alter table public.payment_notifications enable row level security;

-- The member, and staff who can see money. Deliberately NOT
-- user_can_assign_plan: "this member's card is failing" is a money fact,
-- and it is the same audience the chase list already has.
create policy payment_notifications_select on public.payment_notifications
  for select using (
    recipient_profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_money')
  );

-- ============================================================================
-- 2. _enqueue_payment_notice
-- ============================================================================
--
-- The body is rendered here and stored, as in 0172: the worker drains
-- asynchronously and the subscription may have moved on by then. What the
-- member was told has to be what we decided to tell them at the time.

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
  v_gym        text;
  v_tz         text;
  v_email      text;
  v_body       text;
  v_body_email text;
  v_key        text;
  v_count      integer;
begin
  select * into v_ps from public.plan_subscriptions where id = p_subscription_id;
  if v_ps.id is null or v_ps.past_due_since is null then
    return 0;
  end if;

  -- gyms.timezone is free text with no CHECK, so a junk value would make the
  -- `at time zone` below raise. This function runs inside the failure
  -- transaction: a raise here rolls back the dunning flags and 500s the
  -- Stripe webhook, which then retries into the same failure forever. One
  -- bad settings string must not be able to do that.
  select g.name,
         case when exists (select 1 from pg_timezone_names t
                           where t.name = g.timezone)
              then g.timezone else 'UTC' end
    into v_gym, v_tz
    from public.gyms g where g.id = v_ps.gym_id;
  select u.email into v_email from auth.users u where u.id = v_ps.profile_id;

  -- Keyed on the START of the run, so all of Stripe's retries inside one
  -- run collapse onto a single notice.
  v_key := p_kind || ':' || p_subscription_id || ':'
           || extract(epoch from v_ps.past_due_since)::bigint;

  if p_kind = 'payment_final_notice' then
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym')
      || ', and we have stopped trying. Your membership will be cancelled '
      || 'unless it is paid.';
    v_body_email := v_body;
  else
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym')
      || '. Your classes are not affected — you can keep booking — and we '
      || 'will try again';
    -- The email is read the day it lands, so naming the retry date helps.
    -- The in-app row is read live, days later, off a body frozen at write
    -- time — a stored date there is usually already in the past, so that
    -- half stays vague rather than wrong.
    v_body_email := v_body
      -- Rendered in the GYM's timezone, not the server's. A retry at
      -- 23:30 UTC is the following day for a gym in Sydney, and telling
      -- a member the wrong day is worse than telling them no day.
      || case when v_ps.next_payment_attempt is null then ''
              else ' on ' || to_char(
                v_ps.next_payment_attempt at time zone v_tz, 'FMDD Mon') end
      || '. Paying now saves the wait.';
    v_body := v_body || ' soon. Paying now saves the wait.';
  end if;

  insert into public.payment_notifications
    (gym_id, plan_subscription_id, recipient_profile_id, kind, channel,
     recipient, body, status, sent_at, error, idempotency_key)
  select
    v_ps.gym_id, v_ps.id, v_ps.profile_id, p_kind, c.channel,
    -- NOT the member's email address. can_see_money staff can read these
    -- rows and can_see_email is a separate capability — the same reason
    -- 0174 kept the Pay-now URL off the notification. The worker resolves
    -- the address itself under the service role.
    case when c.channel = 'in_app' then v_ps.profile_id::text end,
    case when c.channel = 'in_app' then v_body else v_body_email end,
    case
      when c.channel = 'in_app' then 'sent'
      when v_email is null then 'skipped'
      -- A blanket unsubscribe is about campaigns; a failing payment is not
      -- marketing, and suppressing it would be doing the member harm. The
      -- in-app row always lands either way, as everywhere else.
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
-- 3. _record_payment_failure — enqueue
-- ============================================================================
--
-- Body is 0174's verbatim apart from the enqueue at the end. It sits
-- INSIDE the same transaction as the flag on purpose: a gym must never be
-- able to reach the state "this member is past due and nobody was told".

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

  update public.plan_subscriptions
    set past_due_since        = coalesce(past_due_since, now()),
        payment_failure_count = greatest(payment_failure_count,
                                         coalesce(p_attempt, 1)),
        last_payment_error    = p_error,
        next_payment_attempt  = case
          when coalesce(p_attempt, 1) >= payment_failure_count
          then p_next_attempt
          else next_payment_attempt
        end
    where id = v_ps.id
    returning next_payment_attempt into v_next;

  if p_invoice_url is not null then
    insert into public.membership_invoice_links
      (plan_subscription_id, profile_id, gym_id, invoice_url)
    values (v_ps.id, v_ps.profile_id, v_ps.gym_id, p_invoice_url)
    on conflict (plan_subscription_id) do update
      set invoice_url = excluded.invoice_url, updated_at = now();
  end if;

  -- Either/or, never both. A gym with Stripe's retries turned off gets a
  -- first failure that is ALSO the last one, and sending both kinds in one
  -- transaction would mail the member "we'll try again" and "we have
  -- stopped trying" together. Retries inside a run collapse onto one key,
  -- so the non-final branch is a no-op after the first.
  --
  -- Branch on the ROW, not on p_next_attempt: the update above discards the
  -- parameter when an out-of-order event arrives, and reading the discarded
  -- value would send the final notice off a stale retry.
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

-- ============================================================================
-- 4. _clear_payment_failure — unsend
-- ============================================================================
--
-- Body is 0174's verbatim apart from the notice handling. The email that
-- has not gone out yet must not go out; the in-app one the member may
-- already have seen is marked read so the badge clears rather than
-- nagging about a bill they have paid.

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

    update public.payment_notifications
      set status = 'skipped',
          error  = 'Payment recovered before the email went out'
      where plan_subscription_id = v_id
        and channel = 'email'
        and status = 'queued';

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
-- 5. Read surface + inbox rollup
-- ============================================================================

create or replace function public.mark_payment_notifications_read(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.payment_notifications
    set read_at = now(), status = 'read'
    where gym_id = p_gym_id
      and channel = 'in_app'
      and recipient_profile_id = auth.uid()
      and read_at is null;
end;
$$;

grant execute on function public.mark_payment_notifications_read(uuid)
  to authenticated;

-- RETURNS TABLE gains a column; CREATE OR REPLACE cannot change a
-- function's return shape (0043).
drop function if exists public.inbox_unread_summary();

create function public.inbox_unread_summary()
returns table (
  dm_unread              integer,
  announcement_unread    integer,
  class_broadcast_unread integer,
  class_change_unread    integer,
  payment_unread         integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::int from public.direct_messages
      where recipient_id = auth.uid() and read_at is null
    ),
    (
      select count(*)::int from public.gym_announcements a
      where exists (
        select 1 from public.gym_memberships gm
        where gm.gym_id = a.gym_id
          and gm.profile_id = auth.uid()
          and gm.left_at is null
      )
      and not exists (
        select 1 from public.announcement_reads r
        where r.announcement_id = a.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_session_broadcasts cb
      where exists (
        select 1 from public.class_bookings b
        where b.class_session_id = cb.class_session_id
          and b.profile_id = auth.uid()
      )
      and not exists (
        select 1 from public.class_session_broadcast_reads r
        where r.broadcast_id = cb.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_change_notifications n
      where n.channel = 'in_app'
        and n.recipient_profile_id = auth.uid()
        and n.read_at is null
    ),
    (
      select count(*)::int from public.payment_notifications n
      where n.channel = 'in_app'
        and n.recipient_profile_id = auth.uid()
        and n.read_at is null
    );
$$;

grant execute on function public.inbox_unread_summary() to authenticated;

commit;
