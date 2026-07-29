-- 0206: The money loop acts (docs/roadmap.md phase 2, spec in
-- docs/loop-1-payment-recovery.md).
--
-- Dunning already sees the failure, tells the member once, and splits the
-- money out of the forecast (0174-0177). This closes the gap between seen
-- and chased: an hourly tick works each failing payment as a case through
-- a deterministic policy — no model anywhere in this migration — and the
-- owner approves the judgement calls as cards in the Timeline.
--
--   touch 1  the existing 0175 notice (untouched, system-sent)
--   touch 2  a warm chase 3+ days in, while Stripe is still retrying
--   touch 3  when Stripe gives up: a final note, or the cheaper-plan
--            offer — an OFFER, sent as a message; the member changes
--            plan through the existing self-serve/request flows, the
--            agent never rewrites a subscription
--
-- Hard rules live here, in SQL, not in prompts: the loop is off until an
-- owner switches the job on (authority rows ARE the flag); at most two
-- agent touches per case; one open case per subscription; offers can
-- only name an existing cheaper plan; message text comes from templates
-- the owner approved at switch-on — there is no code path that cancels a
-- membership or invents a discount.
--
-- The outbound queue is agent_outbound_messages, NOT the spec's
-- agent_messages — the AI front desk already owns that name (0132).

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table public.agent_authority (
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  action_kind text not null
    check (action_kind in ('chase_message', 'plan_adjustment_offer')),
  level       text not null default 'approval'
    check (level in ('autonomous', 'approval', 'reserved')),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (gym_id, action_kind)
);

alter table public.agent_authority enable row level security;

create policy agent_authority_money_select on public.agent_authority
  for select using (public.effective_can(gym_id, 'can_see_money'));

create table public.agent_cases (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  plan_subscription_id uuid not null
    references public.plan_subscriptions(id) on delete cascade,
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  opened_at            timestamptz not null default now(),
  stage                text not null default 'watching'
    check (stage in ('watching', 'touch_2_sent', 'offer_pending', 'closed')),
  outcome              text
    check (outcome in ('recovered', 'adjusted', 'lapsed', 'left')),
  closed_at            timestamptz
);

create unique index agent_cases_one_open
  on public.agent_cases(plan_subscription_id)
  where stage <> 'closed';
create index agent_cases_gym_idx on public.agent_cases(gym_id, opened_at desc);

alter table public.agent_cases enable row level security;

create policy agent_cases_money_select on public.agent_cases
  for select using (public.effective_can(gym_id, 'can_see_money'));

alter table public.agent_actions
  add column case_id uuid references public.agent_cases(id) on delete set null;

create index agent_actions_case_idx on public.agent_actions(case_id);

create table public.agent_outbound_messages (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  case_id              uuid references public.agent_cases(id) on delete set null,
  action_id            uuid references public.agent_actions(id) on delete set null,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  channel              text not null default 'email' check (channel in ('email')),
  subject              text not null,
  body                 text not null,
  status               text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  error                text,
  attempts             integer not null default 0,
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);

create index agent_outbound_messages_queued_idx
  on public.agent_outbound_messages(gym_id, status)
  where status = 'queued';

alter table public.agent_outbound_messages enable row level security;

create policy agent_outbound_messages_money_select
  on public.agent_outbound_messages
  for select using (public.effective_can(gym_id, 'can_see_money'));

-- Owner-approved wording. Sends fill {placeholders}; nothing
-- model-authored ever reaches a member from this loop.
create table public.agent_message_templates (
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  kind        text not null check (kind in ('chase_message', 'plan_adjustment_offer')),
  body        text not null check (char_length(body) between 20 and 2000),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz not null default now(),
  primary key (gym_id, kind)
);

alter table public.agent_message_templates enable row level security;

create policy agent_message_templates_money_select
  on public.agent_message_templates
  for select using (public.effective_can(gym_id, 'can_see_money'));

-- ============================================================================
-- 2. Switching the job on — the owner action that creates authority
-- ============================================================================

create or replace function public.set_money_job(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only the owner can change this';
  end if;

  if p_enabled then
    insert into public.agent_authority (gym_id, action_kind, level, updated_by)
    values
      (p_gym_id, 'chase_message', 'approval', auth.uid()),
      (p_gym_id, 'plan_adjustment_offer', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;

    -- Approving the job is approving its words: the defaults are shown
    -- at switch-on and editable later; the send path refuses a case with
    -- no template row.
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'chase_message',
       'Hi {first_name} — it''s {gym_name}. Your {plan_name} payment didn''t '
       || 'go through. It happens — cards expire. There''s a Pay now button '
       || 'on your membership page and it takes a minute. If anything''s '
       || 'wrong, just reply — we''d hate to see you miss training.',
       auth.uid()),
      (p_gym_id, 'plan_adjustment_offer',
       'Hi {first_name} — {gym_name} here. Your {plan_name} payment still '
       || 'isn''t going through. If money''s tight right now we could move '
       || 'you to {offer_plan} at {offer_price} a month instead — no hard '
       || 'feelings either way. Reply and we''ll sort it, or update your '
       || 'card from your membership page.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority where gym_id = p_gym_id;
    -- Open questions die with the job; cases and receipts stay as record.
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_money_job(uuid, boolean) from public, anon;
grant execute on function public.set_money_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 3. Execution — the only path that touches the world
-- ============================================================================

create or replace function public._agent_execute_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a         record;
  t         record;
  v_gym     record;
  v_first   text;
  v_body    text;
  v_subject text;
begin
  select * into a from public.agent_actions where id = p_action_id;
  if a is null or a.status <> 'approved' then
    raise exception 'Action is not approved';
  end if;

  select body into t
    from public.agent_message_templates
    where gym_id = a.gym_id and kind = a.action_kind;
  if t is null then
    raise exception 'No approved template';
  end if;

  select name into v_gym from public.gyms where id = a.gym_id;
  v_first := split_part(coalesce(a.payload->>'member_name', 'there'), ' ', 1);

  v_body := replace(t.body, '{first_name}', v_first);
  v_body := replace(v_body, '{gym_name}', coalesce(v_gym.name, 'your gym'));
  v_body := replace(v_body, '{plan_name}',
    coalesce(a.payload->>'plan_name', 'membership'));
  v_body := replace(v_body, '{offer_plan}',
    coalesce(a.payload->>'offer_plan_name', 'a smaller plan'));
  v_body := replace(v_body, '{offer_price}',
    coalesce(a.payload->>'offer_price', ''));

  v_subject := case a.action_kind
    when 'plan_adjustment_offer'
      then 'A thought about your ' || coalesce(v_gym.name, 'gym') || ' membership'
    else 'About your ' || coalesce(v_gym.name, 'gym') || ' membership payment'
  end;

  insert into public.agent_outbound_messages
    (gym_id, case_id, action_id, recipient_profile_id, subject, body,
     idempotency_key)
  values
    (a.gym_id, a.case_id, a.id, a.subject_profile, v_subject, v_body,
     'agent-action:' || a.id)
  on conflict (idempotency_key) do nothing;

  update public.agent_actions
    set status = 'executed', executed_at = now()
    where id = a.id;

  update public.agent_cases
    set stage = case when a.action_kind = 'plan_adjustment_offer'
                     then 'offer_pending' else 'touch_2_sent' end
    where id = a.case_id and stage <> 'closed';
end;
$$;

revoke all on function public._agent_execute_action(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 4. The decision — owner-facing, ledgered on the same row as the ask
-- ============================================================================

create or replace function public.decide_agent_action(
  p_action_id   uuid,
  p_decision    text,
  p_always_allow boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject';
  end if;

  select * into a from public.agent_actions where id = p_action_id;
  if a is null then raise exception 'No such action'; end if;
  if not public.effective_can(a.gym_id, 'can_see_money') then
    raise exception 'Not allowed';
  end if;
  if a.status <> 'proposed' then
    raise exception 'Already decided';
  end if;

  update public.agent_actions
    set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
        decided_by = auth.uid(),
        decided_at = now()
    where id = a.id;

  if p_decision = 'approve' then
    perform public._agent_execute_action(a.id);
    -- "Always allow this" is itself a ledgered decision — the flip rides
    -- the same transaction as the approval that earned it.
    if p_always_allow then
      update public.agent_authority
        set level = 'autonomous', updated_by = auth.uid(), updated_at = now()
        where gym_id = a.gym_id and action_kind = a.action_kind;
    end if;
  end if;
end;
$$;

revoke all on function public.decide_agent_action(uuid, text, boolean)
  from public, anon;
grant execute on function public.decide_agent_action(uuid, text, boolean)
  to authenticated;

-- ============================================================================
-- 5. The tick — deterministic policy, hourly
-- ============================================================================

create or replace function public.agent_revenue_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d          record;
  c          record;
  v_started  timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_closed   integer := 0;
  v_expired  integer := 0;
  v_level    text;
  v_action   uuid;
  v_case     uuid;
  v_touches  integer;
  v_kind     text;
  v_offer    record;
  v_payload  jsonb;
  v_evidence jsonb;
  v_member   record;
  v_plan     record;
begin
  -- Open a case for every live failure at a gym whose money job is on.
  for d in
    select dn.*, gm.left_at
      from public.plan_subscription_dunning dn
      join public.gym_memberships gm
        on gm.gym_id = dn.gym_id and gm.profile_id = dn.profile_id
      where exists (select 1 from public.agent_authority a
                     where a.gym_id = dn.gym_id)
        and gm.left_at is null
        and not exists (select 1 from public.agent_cases ac
                         where ac.plan_subscription_id = dn.plan_subscription_id
                           and ac.stage <> 'closed')
  loop
    insert into public.agent_cases (gym_id, plan_subscription_id, profile_id)
    values (d.gym_id, d.plan_subscription_id, d.profile_id)
    on conflict do nothing;
    v_opened := v_opened + 1;
  end loop;

  -- Work each open case against the policy.
  for c in
    select ac.*, dn.past_due_since, dn.payment_failure_count,
           dn.next_payment_attempt
      from public.agent_cases ac
      join public.plan_subscription_dunning dn
        on dn.plan_subscription_id = ac.plan_subscription_id
      where ac.stage <> 'closed'
  loop
    -- Hard cap: two agent touches per case, ever.
    select count(*) into v_touches
      from public.agent_actions
      where case_id = c.id and status in ('approved', 'executed');
    if v_touches >= 2 then continue; end if;

    -- One open question per case — and a "No" ends this case's asks for
    -- good. The owner said leave them alone; the system's own notices
    -- (0175) still run regardless.
    if exists (select 1 from public.agent_actions
                where case_id = c.id and status in ('proposed', 'rejected')) then
      continue;
    end if;

    v_kind := null;
    if c.next_payment_attempt is null then
      -- Stripe gave up: the judgement moment. Offer the cheaper plan if
      -- one exists; otherwise a final personal note.
      if not exists (select 1 from public.agent_actions
                      where case_id = c.id
                        and action_kind = 'plan_adjustment_offer'
                        and status in ('approved', 'executed')) then
        v_kind := 'plan_adjustment_offer';
      end if;
    elsif c.stage = 'watching'
      and c.past_due_since <= now() - interval '3 days'
      and c.next_payment_attempt > now() then
      v_kind := 'chase_message';
    end if;
    if v_kind is null then continue; end if;

    select p.full_name into v_member
      from public.profiles p where p.id = c.profile_id;
    select mp.name, coalesce(ps.price_cents, mp.monthly_price_cents) as price_cents
      into v_plan
      from public.plan_subscriptions ps
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where ps.id = c.plan_subscription_id;

    v_payload := jsonb_build_object(
      'member_name', coalesce(v_member.full_name, 'A member'),
      'plan_name', coalesce(v_plan.name, 'membership')
    );

    if v_kind = 'plan_adjustment_offer' then
      -- Offers can only name an existing, active, cheaper recurring plan.
      select mp.plan_id, mp.name, mp.monthly_price_cents into v_offer
        from public.membership_plans mp
        where mp.gym_id = c.gym_id
          and mp.archived_at is null
          and mp.kind in ('unlimited', 'credit_period')
          and mp.monthly_price_cents is not null
          and mp.monthly_price_cents < coalesce(v_plan.price_cents, 0)
        order by mp.monthly_price_cents desc
        limit 1;
      if v_offer is null then
        -- No cheaper plan to offer — fall back to a final chase note.
        v_kind := 'chase_message';
      else
        v_payload := v_payload || jsonb_build_object(
          'offer_plan_id', v_offer.plan_id,
          'offer_plan_name', v_offer.name,
          'offer_price', '£' || (v_offer.monthly_price_cents / 100)::text,
          'final', true
        );
      end if;
    end if;

    v_evidence := jsonb_build_array(
      'Payment has failed ' || c.payment_failure_count || ' time'
        || case when c.payment_failure_count = 1 then '' else 's' end
        || ' since ' || to_char(c.past_due_since, 'DD Mon'),
      case when c.next_payment_attempt is null
        then 'Stripe has stopped retrying.'
        else 'Stripe will try again on '
          || to_char(c.next_payment_attempt, 'DD Mon') || '.' end,
      'On ' || coalesce(v_plan.name, 'their plan')
        || case when v_plan.price_cents is not null
           then ' at £' || (v_plan.price_cents / 100)::text || ' a month.'
           else '.' end
    );

    select level into v_level
      from public.agent_authority
      where gym_id = c.gym_id and action_kind = v_kind;
    if v_level is null or v_level = 'reserved' then continue; end if;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, subject_subscription,
       case_id, payload, evidence, status)
    values
      (c.gym_id, 'revenue', v_kind, c.profile_id, c.plan_subscription_id,
       c.id, v_payload, v_evidence, 'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  -- Close cases whose dunning row has gone: recovery deletes it (0176),
  -- leaving deletes it (leave_gym), lapse flips the subscription.
  for c in
    select ac.*, ps.status as sub_status, gm.left_at
      from public.agent_cases ac
      left join public.plan_subscription_dunning dn
        on dn.plan_subscription_id = ac.plan_subscription_id
      left join public.plan_subscriptions ps on ps.id = ac.plan_subscription_id
      left join public.gym_memberships gm
        on gm.gym_id = ac.gym_id and gm.profile_id = ac.profile_id
      where ac.stage <> 'closed' and dn.plan_subscription_id is null
  loop
    update public.agent_cases
      set stage = 'closed',
          closed_at = now(),
          outcome = case
            when c.left_at is not null then 'left'
            when c.sub_status = 'active' then 'recovered'
            when c.sub_status in ('cancelled') then 'left'
            else 'lapsed'
          end
      where id = c.id;
    update public.agent_actions
      set status = 'expired'
      where case_id = c.id and status = 'proposed';
    v_closed := v_closed + 1;
  end loop;

  -- Silence is not allowed to look like a decision.
  update public.agent_actions
    set status = 'expired'
    where status = 'proposed' and proposed_at < now() - interval '7 days';
  get diagnostics v_expired = row_count;

  perform public._log_cron_run('agent-revenue-tick',
    jsonb_build_object('opened', v_opened, 'proposed', v_proposed,
                       'auto', v_auto, 'closed', v_closed,
                       'expired', v_expired),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('opened', v_opened, 'proposed', v_proposed,
                            'auto', v_auto, 'closed', v_closed);
end;
$$;

revoke all on function public.agent_revenue_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 6. Dispatch — drain the outbound queue through the send worker
-- ============================================================================

create or replace function public.dispatch_agent_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     record;
  v_gyms    integer := 0;
  v_posted  integer := 0;
  v_queued  integer;
  v_started timestamptz := clock_timestamp();
  v_key     text := public._worker_service_key();
begin
  select count(*)::int into v_queued
    from public.agent_outbound_messages
    where status = 'queued';

  if v_key is null then
    perform public._log_cron_run('dispatch-agent-messages',
      jsonb_build_object('skipped', 'no worker_service_key in vault',
                         'queued', v_queued));
    return 0;
  end if;

  for v_gym in
    select distinct gym_id from public.agent_outbound_messages
    where status = 'queued'
  loop
    v_gyms := v_gyms + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-agent-messages',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('gym_id', v_gym.gym_id)
      );
      v_posted := v_posted + 1;
    exception when others then
      null;
    end;
  end loop;

  perform public._log_cron_run('dispatch-agent-messages',
    jsonb_build_object('queued', v_queued, 'gyms', v_gyms, 'posted', v_posted,
                       'has_key', true),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_posted;
end;
$$;

revoke execute on function public.dispatch_agent_messages()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'agent-revenue-tick',
  '7 * * * *',
  $$select public.agent_revenue_tick();$$
);

select cron.schedule(
  'dispatch-agent-messages',
  '*/15 * * * *',
  $$select public.dispatch_agent_messages();$$
);
