-- What happened to the email, from the people who actually carry it
--
-- The report screen has said "Delivered" since 0044 and has never meant
-- it. `reached` is comms_campaign_stats.sent, which counts anything the
-- Resend API accepted — a 200 from the API is a promise to try, not an
-- arrival. Underneath that, three columns and three event kinds have sat
-- unwritten since the day they were created:
--
--   * delivered_at        — nothing sets it
--   * status 'bounced'    — nothing sets it, so bounce rate is 0 by
--                           construction and always has been
--   * email_events kinds 'delivered' / 'bounce' / 'complaint' — no writer
--
-- comms_track_event infers delivery from an open, which is real evidence
-- but only about the fraction of people who open, and only when images
-- load. So "delivered" has meant "sent" and "bounced" has meant nothing.
--
-- Resend knows all of it and will say so over a webhook. This migration
-- is the database half of listening: the writer, the storage, and the
-- three definitions the surfaces then read.
--
-- FOUR DECISIONS, taken with the owner, that the shape here encodes:
--
-- 1. "Successful" means delivered and not bounced. Opens and clicks sit
--    underneath as engagement — they measure the writing, not the pipe.
--    Delivered-then-bounced is rare but real (a mailbox that accepts at
--    the edge and rejects behind it), which is why the two conditions are
--    both written out rather than one assumed from the other.
--
-- 2. A hard bounce suppresses the address and the owner is told. It goes
--    to a NEW table, not email_unsubscribes: "we cannot reach you" and
--    "you asked us to stop" are different facts about a person, they are
--    reversed by different people for different reasons, and collapsing
--    them would let a typo'd address read on the member's own preferences
--    screen as though they had opted out. A complaint — someone pressing
--    "this is spam" — suppresses too, and is the one thing in email you
--    never retry.
--
-- 3. Old sends are marked untracked, not zero. A real zero and an
--    unmeasured zero are different facts and a report that shows 0% to
--    mean "we were not listening" is worse than one that says so.
--    delivery_tracked starts false for every campaign and is flipped by
--    the writer below the first time a real event lands for it — so it is
--    derived from what actually arrived rather than from a date, and a
--    send whose webhook was never wired up honestly reads as unmeasured.
--
-- 4. The numbers appear on the campaign report, in the Timeline receipt
--    when a send finishes, and as an answer in the bar. This migration
--    serves all three from one function.
--
-- Not done here, and deliberately: the transactional senders (class
-- changes, cover, payment notices) still mail a hard-bounced address.
-- Resend suppresses at the account level once an address has hard
-- bounced, so those sends are refused by the provider rather than
-- delivered — the cost is a failed row, not a bad reputation. Teaching
-- five enqueue functions the same predicate is worth doing on its own
-- and not worth restating five function bodies for here.

begin;

-- ============================================================================
-- 1. Where the new facts live
-- ============================================================================

alter table public.email_campaign_recipients
  add column complained_at timestamptz;

-- The provider's id for the message is the only join between a webhook
-- and a recipient; it has been stored since 0044 and never looked up.
create index email_campaign_recipients_provider_msg_idx
  on public.email_campaign_recipients (provider_message_id)
  where provider_message_id is not null;

alter table public.email_campaigns
  add column delivery_tracked boolean not null default false;

-- Addresses we cannot reach. Separate from email_unsubscribes on purpose
-- (decision 2). No insert or update policy: the only writer is the
-- service-role function below, so a suppression cannot be forged from a
-- client. Delete is allowed — an owner who knows the address was a typo
-- and has been fixed clears it, and the next send goes out.
create table public.email_suppressions (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  email         text not null,
  reason        text not null check (reason in ('hard_bounce', 'complaint')),
  detail        text,
  campaign_id   uuid references public.email_campaigns(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create unique index email_suppressions_unique
  on public.email_suppressions (gym_id, lower(email));
create index email_suppressions_gym_idx
  on public.email_suppressions (gym_id, last_seen_at desc);

alter table public.email_suppressions enable row level security;

create policy email_suppressions_select on public.email_suppressions
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_suppressions_delete on public.email_suppressions
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 2. The writer
-- ============================================================================
--
-- Called by the resend-webhook edge function with the service role, once
-- per verified event. Everything it needs to find the recipient is the
-- provider's message id, which is why it takes no gym: the gym is
-- whatever the matched row says, so a forged payload cannot aim at
-- another tenant. Unmatched ids return false rather than raising —
-- Resend also sends events for the transactional mail this table knows
-- nothing about, and a webhook that 500s on those gets retried forever.

create or replace function public.comms_apply_delivery_event(
  p_provider_message_id text,
  p_kind                text,
  p_hard                boolean default true,
  p_detail              text default null,
  p_occurred_at         timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_gym       uuid;
  v_campaign  uuid;
  v_email     text;
  v_detail    text := left(nullif(trim(coalesce(p_detail, '')), ''), 500);
  v_at        timestamptz := coalesce(p_occurred_at, now());
begin
  if p_provider_message_id is null or length(trim(p_provider_message_id)) = 0 then
    return false;
  end if;

  select id, gym_id, campaign_id, email
    into v_recipient, v_gym, v_campaign, v_email
    from public.email_campaign_recipients
    where provider_message_id = p_provider_message_id
    limit 1;
  if v_recipient is null then
    return false;
  end if;

  -- A real event arrived for this campaign, so its report can be trusted
  -- to be measuring something (decision 3).
  update public.email_campaigns
    set delivery_tracked = true
    where id = v_campaign and delivery_tracked = false;

  if p_kind = 'delivered' then
    update public.email_campaign_recipients
      set delivered_at = coalesce(delivered_at, v_at),
          status       = case when status in ('queued', 'sent') then 'delivered'
                              else status end
      where id = v_recipient;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at)
      values (v_gym, v_campaign, v_recipient, 'delivered', v_at);

  elsif p_kind = 'bounced' then
    -- A transient bounce is the provider still trying: it is worth
    -- recording and wrong to suppress on. Only a permanent one changes
    -- the recipient's status or stops future mail.
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at, meta)
      values (v_gym, v_campaign, v_recipient, 'bounce', v_at,
              jsonb_build_object('hard', coalesce(p_hard, true), 'detail', v_detail));

    if coalesce(p_hard, true) then
      update public.email_campaign_recipients
        set status = 'bounced',
            error  = coalesce(v_detail, 'The address bounced')
        where id = v_recipient;

      insert into public.email_suppressions
        (gym_id, email, reason, detail, campaign_id, first_seen_at, last_seen_at)
      values (v_gym, v_email, 'hard_bounce', v_detail, v_campaign, v_at, v_at)
      on conflict (gym_id, lower(email)) do update
        set last_seen_at = greatest(email_suppressions.last_seen_at, excluded.last_seen_at),
            detail       = coalesce(excluded.detail, email_suppressions.detail),
            campaign_id  = coalesce(excluded.campaign_id, email_suppressions.campaign_id);
    end if;

  elsif p_kind = 'complained' then
    update public.email_campaign_recipients
      set complained_at = coalesce(complained_at, v_at)
      where id = v_recipient;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at)
      values (v_gym, v_campaign, v_recipient, 'complaint', v_at);

    -- A complaint outranks a bounce: the address works, the person does
    -- not want it, and that is the stronger reason never to send again.
    insert into public.email_suppressions
      (gym_id, email, reason, detail, campaign_id, first_seen_at, last_seen_at)
    values (v_gym, v_email, 'complaint', v_detail, v_campaign, v_at, v_at)
    on conflict (gym_id, lower(email)) do update
      set reason       = 'complaint',
          last_seen_at = greatest(email_suppressions.last_seen_at, excluded.last_seen_at),
          detail       = coalesce(excluded.detail, email_suppressions.detail),
          campaign_id  = coalesce(excluded.campaign_id, email_suppressions.campaign_id);

  else
    raise exception 'Unknown delivery event kind: %', p_kind;
  end if;

  return true;
end;
$$;

revoke all on function public.comms_apply_delivery_event(text, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.comms_apply_delivery_event(text, text, boolean, text, timestamptz)
  to service_role;

-- ============================================================================
-- 3. An open still proves arrival
-- ============================================================================
--
-- 0059's body, with one addition: opens and clicks now stamp
-- delivered_at as well as promoting the status. They already promoted the
-- status to 'delivered' on the reasoning that a person reading a message
-- received it — that reasoning is sound and the timestamp was simply
-- never written, which would leave a campaign reporting more opens than
-- deliveries the moment delivered_at became the definition.

create or replace function public.comms_track_event(
  p_campaign_id uuid,
  p_recipient_id uuid,
  p_kind text,
  p_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     uuid;
  v_profile uuid;
  v_email   text;
begin
  select gym_id, profile_id, email
    into v_gym, v_profile, v_email
    from public.email_campaign_recipients
    where id = p_recipient_id and campaign_id = p_campaign_id;
  if v_gym is null then
    return;
  end if;

  if p_kind = 'open' then
    update public.email_campaign_recipients
      set open_count      = open_count + 1,
          last_opened_at   = now(),
          first_opened_at  = coalesce(first_opened_at, now()),
          delivered_at     = coalesce(delivered_at, now()),
          status           = case when status in ('queued','sent') then 'delivered' else status end
      where id = p_recipient_id;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind)
      values (v_gym, p_campaign_id, p_recipient_id, 'open');

  elsif p_kind = 'click' then
    update public.email_campaign_recipients
      set click_count      = click_count + 1,
          last_clicked_at   = now(),
          first_clicked_at  = coalesce(first_clicked_at, now()),
          first_opened_at   = coalesce(first_opened_at, now()),
          delivered_at      = coalesce(delivered_at, now()),
          status            = case when status in ('queued','sent') then 'delivered' else status end
      where id = p_recipient_id;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, url)
      values (v_gym, p_campaign_id, p_recipient_id, 'click', p_url);

  elsif p_kind = 'unsubscribe' then
    update public.email_campaign_recipients
      set unsubscribed_at = coalesce(unsubscribed_at, now())
      where id = p_recipient_id;
    insert into public.email_unsubscribes (gym_id, email, profile_id, campaign_id)
      values (v_gym, v_email, v_profile, p_campaign_id)
      on conflict (gym_id, lower(email)) where topic_id is null do nothing;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind)
      values (v_gym, p_campaign_id, p_recipient_id, 'unsubscribe');

  else
    raise exception 'Unknown tracking event kind: %', p_kind;
  end if;
end;
$$;

-- ============================================================================
-- 4. A suppressed address is not in the next audience
-- ============================================================================
--
-- 0182's body with one more subtraction. Suppression is checked here
-- rather than at send time so the audience COUNT the owner is shown
-- before they press send is the number who will actually be mailed.

create or replace function public.comms_audience_rows(
  p_gym_id     uuid,
  p_definition jsonb,
  p_topic_id   uuid
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language sql
security definer
stable
set search_path = public
as $$
  with base as (
    select gm.profile_id
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.left_at is null
      and gm.role = 'member'
  ),
  selected as (
    select b.profile_id
    from base b
    where case coalesce(p_definition->>'kind', 'all_members')
      when 'all_members' then true
      when 'cohort' then exists (
        select 1 from public.v_member_cohort c
        where c.gym_id = p_gym_id and c.profile_id = b.profile_id
          and (
            ((p_definition->'cohorts') ? 'intro'         and c.is_intro)         or
            ((p_definition->'cohorts') ? 'active'        and c.is_active)        or
            ((p_definition->'cohorts') ? 'paying'        and c.is_paying)        or
            ((p_definition->'cohorts') ? 'expiring_soon' and c.is_expiring_soon) or
            ((p_definition->'cohorts') ? 'expired'       and c.is_expired)
          )
      )
      when 'cohorts' then exists (
        select 1 from public.v_member_cohort c
        where c.gym_id = p_gym_id and c.profile_id = b.profile_id
          and (
            ((p_definition->'cohorts') ? 'intro'         and c.is_intro)         or
            ((p_definition->'cohorts') ? 'active'        and c.is_active)        or
            ((p_definition->'cohorts') ? 'paying'        and c.is_paying)        or
            ((p_definition->'cohorts') ? 'expiring_soon' and c.is_expiring_soon) or
            ((p_definition->'cohorts') ? 'expired'       and c.is_expired)
          )
      )
      when 'tags' then exists (
        select 1 from public.member_tags mt
        where mt.gym_id = p_gym_id and mt.profile_id = b.profile_id
          and (p_definition->'tags') ? mt.label
      )
      when 'manual' then (p_definition->'profile_ids') ? b.profile_id::text
      else false
    end
  ),
  member_rows as (
    select distinct on (lower(u.email))
      s.profile_id,
      p.full_name,
      u.email::text as email
    from selected s
    join public.profiles p on p.id = s.profile_id
    join auth.users u on u.id = s.profile_id
    where u.email is not null
      and length(trim(u.email)) > 0
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(u.email)
          and eu.topic_id is null
      )
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(u.email)
          and eu.topic_id = p_topic_id
          and p_topic_id is not null
      )
      and not exists (
        select 1 from public.email_suppressions es
        where es.gym_id = p_gym_id
          and lower(es.email) = lower(u.email)
      )
    order by lower(u.email)
  ),
  pending_rows as (
    select distinct on (lower(pm.email))
      null::uuid as profile_id,
      pm.full_name,
      pm.email::text as email
    from public.pending_members pm
    where coalesce(p_definition->>'kind', '') = 'pending_members'
      and pm.gym_id = p_gym_id
      and pm.status in ('pending', 'invited')
      and pm.email is not null
      and length(trim(pm.email)) > 0
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(pm.email)
          and eu.topic_id is null
      )
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(pm.email)
          and eu.topic_id = p_topic_id
          and p_topic_id is not null
      )
      and not exists (
        select 1 from public.email_suppressions es
        where es.gym_id = p_gym_id
          and lower(es.email) = lower(pm.email)
      )
    order by lower(pm.email)
  )
  select * from member_rows
  union all
  select * from pending_rows;
$$;

-- ============================================================================
-- 5. The three numbers, defined once
-- ============================================================================
--
-- RETURNS shape changes, so this is a drop rather than a replace.
--
--   sent        anything the provider accepted, including what later
--               bounced — it did leave the building
--   delivered   a mailbox took it: a delivered event, or an open, which
--               is proof of the same thing from the other end
--   successful  delivered and not bounced (decision 1)
--
-- tracked rides along so a caller cannot render the numbers without the
-- fact that says whether they mean anything.

drop function if exists public.comms_campaign_stats(uuid);

create function public.comms_campaign_stats(
  p_campaign_id uuid
) returns table (
  recipients   integer,
  sent         integer,
  delivered    integer,
  successful   integer,
  simulated    integer,
  failed       integer,
  bounced      integer,
  complained   integer,
  opened       integer,
  clicked      integer,
  unsubscribed integer,
  skipped      integer,
  tracked      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym     uuid;
  v_tracked boolean;
begin
  select ec.gym_id, ec.delivery_tracked
    into v_gym, v_tracked
    from public.email_campaigns ec where ec.id = p_campaign_id;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where r.status in ('sent','delivered','bounced','simulated'))::int,
    count(*) filter (where r.delivered_at is not null)::int,
    count(*) filter (where r.delivered_at is not null and r.status <> 'bounced')::int,
    count(*) filter (where r.status = 'simulated')::int,
    count(*) filter (where r.status = 'failed')::int,
    count(*) filter (where r.status = 'bounced')::int,
    count(*) filter (where r.complained_at is not null)::int,
    count(*) filter (where r.first_opened_at is not null)::int,
    count(*) filter (where r.first_clicked_at is not null)::int,
    count(*) filter (where r.unsubscribed_at is not null)::int,
    count(*) filter (where r.status = 'skipped')::int,
    coalesce(v_tracked, false)
  from public.email_campaign_recipients r
  where r.campaign_id = p_campaign_id;
end;
$$;

grant execute on function public.comms_campaign_stats(uuid) to authenticated;

-- ============================================================================
-- 6. The send appears in the Timeline when it finishes
-- ============================================================================
--
-- 0204's body with a campaign branch, and two gates corrected.
--
-- The receipt is computed rather than logged, which is what makes it
-- honest about a fact that arrives late: bounces land minutes to hours
-- after the last email goes out, so a row written at send time would be
-- permanently wrong about them and a row read at scroll time is not.
--
-- The gate corrections are 0226's drift. That migration gave leads their
-- own capability and re-pointed every lead surface at it; this function
-- kept reading user_can_assign_plan for both its lead rows and its
-- membership-request rows, which is now the wrong key for one of them and
-- a raw role helper — no per-role override, no left_at guard — for both.
-- user_can_cover is the same helper shape and resolves to owner-or-coach,
-- which is exactly what effective_can(can_claim_cover) resolves to by
-- default, with the overrides and the left_at guard honoured.

create or replace function public.timeline_feed(
  p_gym_id uuid,
  p_before timestamptz default null,
  p_limit  integer default 50
) returns table (
  item_id     text,
  kind        text,
  occurred_at timestamptz,
  subject     text,
  detail      jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_before timestamptz := coalesce(p_before, now() + interval '1 day');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_money  boolean;
  v_leads  boolean;
  v_plans  boolean;
  v_cover  boolean;
  v_comms  boolean;
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not allowed';
  end if;
  v_money := public.effective_can(p_gym_id, 'can_see_money');
  v_leads := public.effective_can(p_gym_id, 'can_work_leads');
  v_plans := public.effective_can(p_gym_id, 'can_assign_plan');
  v_cover := public.effective_can(p_gym_id, 'can_claim_cover');
  v_comms := public.effective_can(p_gym_id, 'can_manage_comms');

  return query
  select * from (

    -- Someone joined.
    select 'member:' || gm.id::text        as item_id,
           'member_joined'                 as kind,
           gm.created_at                   as occurred_at,
           coalesce(p.full_name, 'A new member') as subject,
           '{}'::jsonb                     as detail
      from public.gym_memberships gm
      join public.profiles p on p.id = gm.profile_id
     where gm.gym_id = p_gym_id
       and gm.role = 'member'
       and gm.left_at is null
       and gm.created_at < v_before

    union all

    -- An enquiry came in.
    select 'lead:' || l.id::text,
           'lead_captured',
           l.captured_at,
           l.full_name,
           jsonb_build_object(
             'source', ls.label,
             'status', l.status::text
           )
      from public.leads l
      left join public.lead_sources ls on ls.id = l.source_id
     where v_leads
       and l.gym_id = p_gym_id
       and l.archived_at is null
       and l.captured_at < v_before

    union all

    -- A payment is failing. Presence of a dunning row IS the live failure
    -- (recovery deletes it — 0176), so this line disappears when the money
    -- arrives, the same way the Money block's At-risk figure does. The
    -- decline reason stays off the feed on purpose.
    select 'dunning:' || d.plan_subscription_id::text,
           'payment_failing',
           d.past_due_since,
           coalesce(p.full_name, 'A member'),
           jsonb_build_object(
             'plan_name', mp.name,
             'next_payment_attempt', d.next_payment_attempt,
             'failure_count', d.payment_failure_count
           )
      from public.plan_subscription_dunning d
      join public.profiles p on p.id = d.profile_id
      join public.plan_subscriptions ps on ps.id = d.plan_subscription_id
      join public.membership_plans mp on mp.plan_id = ps.plan_id
     where v_money
       and d.gym_id = p_gym_id
       and d.past_due_since < v_before

    union all

    -- A coach asked for cover.
    select 'coverreq:' || cr.id::text,
           'cover_requested',
           cr.created_at,
           coalesce(p.full_name, 'A coach'),
           jsonb_build_object(
             'status', cr.status,
             'class_count', (
               select count(*) from public.cover_request_sessions s
                where s.request_id = cr.id
             ),
             'range_start', cr.range_start,
             'range_end', cr.range_end
           )
      from public.cover_requests cr
      join public.profiles p on p.id = cr.requested_by
     where v_cover
       and cr.gym_id = p_gym_id
       and cr.created_at < v_before

    union all

    -- A class got covered.
    select 'coverclaim:' || s.id::text,
           'cover_claimed',
           s.claimed_at,
           coalesce(claimer.full_name, 'A coach'),
           jsonb_build_object(
             'covered_for', original.full_name
           )
      from public.cover_request_sessions s
      join public.profiles claimer on claimer.id = s.claimed_by
      left join public.profiles original on original.id = s.original_coach_id
     where v_cover
       and s.gym_id = p_gym_id
       and s.claimed_by is not null
       and s.claimed_at < v_before

    union all

    -- The gym closed a window of dates.
    select 'closure:' || c.id::text,
           'gym_closed',
           c.created_at,
           coalesce(c.reason, ''),
           jsonb_build_object(
             'starts_on', c.starts_on,
             'ends_on', c.ends_on,
             'lifted', c.lifted_at is not null
           )
      from public.gym_closures c
     where c.gym_id = p_gym_id
       and c.created_at < v_before

    union all

    -- A member is asking to change or cancel — the stream's only
    -- question cards in phase 1, decided through the existing
    -- stripe-modify-subscription path, not a new one.
    select 'mcr:' || r.id::text,
           'membership_request',
           r.created_at,
           coalesce(p.full_name, 'A member'),
           jsonb_build_object(
             'request_id', r.id,
             'request_kind', r.kind::text,
             'current_plan', cur.name,
             'target_plan', tgt.name,
             'member_note', r.member_note
           )
      from public.membership_change_requests r
      join public.profiles p on p.id = r.profile_id
      left join public.plan_subscriptions ps on ps.id = r.plan_subscription_id
      left join public.membership_plans cur on cur.plan_id = ps.plan_id
      left join public.membership_plans tgt on tgt.plan_id = r.target_plan_id
     where v_plans
       and r.gym_id = p_gym_id
       and r.status = 'pending'
       and r.created_at < v_before

    union all

    -- A send finished, and what came of it. Counted at read time, not at
    -- send time: bounces arrive after the last email goes out.
    select 'campaign:' || ec.id::text,
           'campaign_sent',
           coalesce(ec.sent_at, ec.updated_at),
           coalesce(nullif(ec.title, ''), ec.subject, 'A campaign'),
           jsonb_build_object(
             'campaign_id', ec.id,
             'subject', ec.subject,
             'status', ec.status,
             'tracked', ec.delivery_tracked,
             'recipients', st.recipients,
             'sent', st.sent,
             'delivered', st.delivered,
             'successful', st.successful,
             'simulated', st.simulated,
             'bounced', st.bounced,
             'complained', st.complained,
             'opened', st.opened,
             'skipped', st.skipped
           )
      from public.email_campaigns ec
      cross join lateral (
        select
          count(*)::int as recipients,
          count(*) filter (where r.status in ('sent','delivered','bounced','simulated'))::int as sent,
          count(*) filter (where r.delivered_at is not null)::int as delivered,
          count(*) filter (where r.delivered_at is not null and r.status <> 'bounced')::int as successful,
          count(*) filter (where r.status = 'simulated')::int as simulated,
          count(*) filter (where r.status = 'bounced')::int as bounced,
          count(*) filter (where r.complained_at is not null)::int as complained,
          count(*) filter (where r.first_opened_at is not null)::int as opened,
          count(*) filter (where r.status = 'skipped')::int as skipped
        from public.email_campaign_recipients r
        where r.campaign_id = ec.id
      ) st
     where v_comms
       and ec.gym_id = p_gym_id
       and ec.status in ('sent', 'failed', 'cancelled')
       and coalesce(ec.sent_at, ec.updated_at) < v_before

    union all

    -- The ledger itself. Empty until the first loop writes to it; unioned
    -- now so the surface needs no change when it does.
    select 'action:' || a.id::text,
           'agent_action',
           a.proposed_at,
           coalesce(p.full_name, ''),
           jsonb_build_object(
             'teammate', a.teammate,
             'action_kind', a.action_kind,
             'status', a.status,
             'payload', a.payload,
             'evidence', a.evidence
           )
      from public.agent_actions a
      left join public.profiles p on p.id = a.subject_profile
     where v_money
       and a.gym_id = p_gym_id
       and a.proposed_at < v_before

  ) t
  order by t.occurred_at desc
  limit v_limit;
end;
$$;

commit;
