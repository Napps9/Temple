-- 0244: Say when you held something back
--
-- 0242 gave the gym a daily ask budget and then spent it silently. An
-- owner opening a quiet Timeline could not tell "nothing needed saying
-- today" from "five things were said and three are waiting until
-- tomorrow" — and those are opposite facts about their gym. It is the
-- worst shape a limit can have: invisible, so it looks like the product
-- has nothing to offer rather than that it is being careful.
--
-- One row per gym per day, upserted, counting what was held. Not a queue
-- and not a list of who: the deferred work is re-derived by tomorrow's
-- tick from live attendance and balances, so a stored list would go stale
-- the moment somebody trained. The count is the honest thing to keep —
-- it says a day was full, which is all the owner needs to know.
--
-- Gated on can_see_money in the feed, the same capability the proposals
-- themselves are gated on. A line about held-back proposals reaching
-- somebody who cannot see proposals would be a mystery rather than an
-- explanation.

begin;

create table if not exists public.agent_deferrals (
  gym_id   uuid not null references public.gyms(id) on delete cascade,
  on_day   date not null,
  held     integer not null default 0,
  first_at timestamptz not null default now(),
  primary key (gym_id, on_day)
);

alter table public.agent_deferrals enable row level security;

-- No client write path and no client read path: the feed is the only way
-- in, and it is security definer.
comment on table public.agent_deferrals is
  'One row per gym per day counting proposals the daily ask budget held '
  'back (0242). Read through timeline_feed only.';

create or replace function public._agent_record_deferral(p_gym_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.agent_deferrals (gym_id, on_day, held)
  values (p_gym_id, current_date, 1)
  on conflict (gym_id, on_day)
    do update set held = public.agent_deferrals.held + 1;
$$;

revoke all on function public._agent_record_deferral(uuid)
  from public, anon, authenticated;

-- Nothing sweeps this yet on purpose: a row is two integers and a date,
-- one per gym per busy day. If it ever needs a broom it belongs in the
-- retention sweep beside the rest, not in its own cron.

CREATE OR REPLACE FUNCTION public.agent_retention_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_level    text;
  v_action   uuid;
  v_weeks    integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name,
           max(cb.attended_at) as last_seen,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.class_bookings cb
        on cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
       and cb.attended_at is not null
      where a.action_kind = 'retention_message' and a.level <> 'reserved'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Never the same member twice inside 45 days, and a "No" blocks
        -- the window too.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'retention_message'
                           and aa.proposed_at > now() - interval '45 days')
      group by gm.gym_id, gm.profile_id, p.full_name, a.level
      having max(cb.attended_at) between now() - interval '90 days'
                                     and now() - interval '21 days'
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      -- 0244. Say so. A budget that holds work back and tells nobody
      -- leaves an owner unable to tell a quiet day from a full one.
      perform public._agent_record_deferral(m.gym_id);
      continue;
    end if;

    -- At most three proposals per gym per day: quiet by design.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'retention_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_weeks := greatest(1, floor(extract(epoch from now() - m.last_seen)
      / 604800)::integer);

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'retention_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'weeks_absent', v_weeks
       ),
       jsonb_build_array(
         'Last trained on ' || to_char(m.last_seen, 'DD Mon') || ' — '
           || v_weeks || ' week' || case when v_weeks = 1 then '' else 's' end
           || ' ago.',
         'Still on an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    v_level := m.level;
    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-retention-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_first_week_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_action   uuid;
  v_days     integer;
  v_booked   integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, gm.created_at as joined_at,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      where a.action_kind = 'first_week_message' and a.level <> 'reserved'
        and gm.created_at
              between now() - interval '30 days' and now() - interval '7 days'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Rule 1. A migration is not a new joiner.
        and not exists (select 1 from public.pending_members pm
                         where pm.gym_id = gm.gym_id
                           and pm.linked_profile_id = gm.profile_id)
        -- Has never trained. Booking and not turning up still counts as
        -- never started — the evidence below says which it was.
        and not exists (select 1 from public.class_bookings cb
                         where cb.gym_id = gm.gym_id
                           and cb.profile_id = gm.profile_id
                           and cb.attended_at is not null)
        -- Rule 2. Once, ever — so a "no" is final for that member.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'first_week_message')
      order by gm.created_at
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      -- 0244. Say so. A budget that holds work back and tells nobody
      -- leaves an owner unable to tell a quiet day from a full one.
      perform public._agent_record_deferral(m.gym_id);
      continue;
    end if;

    -- Rule 4.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'first_week_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_days := greatest(1, floor(extract(epoch from now() - m.joined_at)
      / 86400)::integer);

    -- Booked and not come is a different thing from never booked, and the
    -- owner decides differently on each, so the card says which.
    select count(*)::int into v_booked
      from public.class_bookings cb
      where cb.gym_id = m.gym_id and cb.profile_id = m.profile_id;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'first_week_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'days_since_join', v_days
       ),
       jsonb_build_array(
         'Joined on ' || to_char(m.joined_at, 'DD Mon') || ' — '
           || v_days || ' day' || case when v_days = 1 then '' else 's' end
           || ' ago.',
         case when v_booked = 0
              then 'Has not booked anything yet.'
              else 'Booked ' || v_booked || ' class'
                   || case when v_booked = 1 then '' else 'es' end
                   || ' and has not been to one.'
         end,
         'Paying for an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-first-week-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_credits_low_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_action   uuid;
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_phrase   text;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, a.level,
           ps.id as subscription_id, ps.credit_balance, mp.name as plan_name,
           (select max(cb.attended_at) from public.class_bookings cb
             where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
               and cb.attended_at is not null) as last_seen
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.plan_subscriptions ps
        on ps.gym_id = gm.gym_id and ps.profile_id = gm.profile_id
       and ps.status = 'active'
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where a.action_kind = 'credits_low_message' and a.level <> 'reserved'
        -- Rule 1. A credit_period balance resets; only a pack runs out.
        and mp.kind = 'credit_pack'
        -- Rule 2. One or two left. Zero is already locked out.
        and ps.credit_balance between 1 and 2
        -- Rule 4. Once per subscription per 60 days.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.action_kind = 'credits_low_message'
                           and aa.payload->>'subscription_id' = ps.id::text
                           and aa.proposed_at > now() - interval '60 days')
        -- Rule 6 (0241). The upgrade offer already carries this message.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'plan_upgrade_offer'
                           and aa.status <> 'rejected'
                           and aa.proposed_at > now() - interval '7 days')
      -- Rule 3. Trained inside 21 days, which is retention's threshold in
      -- the other direction, so no member can be held by both jobs.
      group by gm.gym_id, gm.profile_id, p.full_name, a.level, ps.id,
               ps.credit_balance, mp.name
      having (select max(cb.attended_at) from public.class_bookings cb
               where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
                 and cb.attended_at is not null) > now() - interval '21 days'
      order by ps.credit_balance, gm.profile_id
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      -- 0244. Say so. A budget that holds work back and tells nobody
      -- leaves an owner unable to tell a quiet day from a full one.
      perform public._agent_record_deferral(m.gym_id);
      continue;
    end if;

    -- Rule 5.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'credits_low_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_phrase := m.credit_balance || ' class'
      || case when m.credit_balance = 1 then '' else 'es' end;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'revenue', 'credits_low_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'plan_name', m.plan_name,
         'credits_left', m.credit_balance,
         'credits_left_phrase', v_phrase,
         'subscription_id', m.subscription_id::text
       ),
       jsonb_build_array(
         v_phrase || ' left on their ' || m.plan_name || '.',
         'Last trained on ' || to_char(m.last_seen, 'DD Mon') || '.',
         'Still booking, so this is a top-up rather than a goodbye.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-credits-low-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_plan_upgrade_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m           record;
  v_offer     record;
  v_started   timestamptz := clock_timestamp();
  v_action    uuid;
  v_proposed  integer := 0;
  v_auto      integer := 0;
  v_per_class integer;
  v_at_rate   integer;
  v_saving    integer;
  v_phrase    text;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, a.level, g.currency,
           ps.id as subscription_id, ps.credit_balance, ps.price_cents,
           mp.name as plan_name, mp.credit_count,
           (select count(*) from public.class_bookings cb
             where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
               and cb.attended_at > now() - interval '30 days')::int
             as attended_30d
      from public.agent_authority a
      join public.gyms g on g.id = a.gym_id
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.plan_subscriptions ps
        on ps.gym_id = gm.gym_id and ps.profile_id = gm.profile_id
       and ps.status = 'active'
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where a.action_kind = 'plan_upgrade_offer' and a.level <> 'reserved'
        -- Rule 1, shared with credits_low: a pack, down to one or two.
        and mp.kind = 'credit_pack'
        and ps.credit_balance between 1 and 2
        -- Rule 2 needs both of these to divide by, and a free or comped
        -- pack has no per-class price to beat.
        and coalesce(mp.credit_count, 0) > 0
        and coalesce(ps.price_cents, 0) > 0
        -- Rule 5. Once per member per 180 days.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'plan_upgrade_offer'
                           and aa.proposed_at > now() - interval '180 days')
        -- Rule 1 again: trained inside 21 days, retention's threshold in
        -- the other direction, so no member is held by both jobs.
        and exists (select 1 from public.class_bookings cb
                     where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
                       and cb.attended_at > now() - interval '21 days')
      order by gm.profile_id
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      -- 0244. Say so. A budget that holds work back and tells nobody
      -- leaves an owner unable to tell a quiet day from a full one.
      perform public._agent_record_deferral(m.gym_id);
      continue;
    end if;

    -- Rule 6.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'plan_upgrade_offer'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_per_class := m.price_cents / m.credit_count;
    v_at_rate   := m.attended_30d * v_per_class;

    -- Rule 3. Cheapest live recurring plan that actually covers the way
    -- they train. An unlimited plan always does; a credit_period one only
    -- when its allowance reaches what they did last month.
    select mp2.plan_id, mp2.name, mp2.monthly_price_cents
      into v_offer
      from public.membership_plans mp2
      where mp2.gym_id = m.gym_id
        and mp2.archived_at is null
        and mp2.kind in ('unlimited', 'credit_period')
        and coalesce(mp2.monthly_price_cents, 0) > 0
        and (mp2.kind = 'unlimited'
             or coalesce(mp2.credit_count, 0) >= m.attended_30d)
      order by mp2.monthly_price_cents asc, mp2.name asc
      limit 1;
    if v_offer.plan_id is null then
      continue;
    end if;

    -- Rules 2 and 4.
    v_saving := v_at_rate - v_offer.monthly_price_cents;
    if v_saving < greatest(v_at_rate / 5, v_per_class) then
      continue;
    end if;

    v_phrase := m.credit_balance || ' class'
      || case when m.credit_balance = 1 then '' else 'es' end;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'revenue', 'plan_upgrade_offer', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'plan_name', m.plan_name,
         'credits_left', m.credit_balance,
         'credits_left_phrase', v_phrase,
         'attended_30d', m.attended_30d,
         'offer_plan_name', v_offer.name,
         'offer_price', public.money_text(v_offer.monthly_price_cents, m.currency),
         'upgrade_saving', public.money_text(v_saving, m.currency),
         'subscription_id', m.subscription_id::text
       ),
       jsonb_build_array(
         'Trained ' || m.attended_30d || ' time'
           || case when m.attended_30d = 1 then '' else 's' end
           || ' in the last 30 days, with ' || v_phrase || ' left.',
         'At ' || public.money_text(v_per_class, m.currency)
           || ' a class on their ' || m.plan_name || ', another month at '
           || 'that rate is ' || public.money_text(v_at_rate, m.currency) || '.',
         v_offer.name || ' is '
           || public.money_text(v_offer.monthly_price_cents, m.currency)
           || ' — ' || public.money_text(v_saving, m.currency) || ' better off.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-plan-upgrade-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.timeline_feed(p_gym_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(item_id text, kind text, occurred_at timestamp with time zone, subject text, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- 0244. The day the gym had more worth saying than it was allowed to
    -- say. One line, not a list: the point is that an owner can tell a
    -- quiet day from a full one, not that they can audit the queue.
    select 'held:' || h.gym_id::text || ':' || h.on_day::text,
           'held_back',
           h.first_at,
           '',
           jsonb_build_object('held', h.held)
      from public.agent_deferrals h
     where v_money
       and h.gym_id = p_gym_id
       and h.first_at < v_before

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
             'range_end', cr.range_end,
             -- 0243. Who asked, so the card can leave the claim buttons
             -- off your own request rather than offering you a class
             -- claim_cover would refuse.
             'requested_by', cr.requested_by,
             -- The offers still open, so the Timeline card has something
             -- to claim. Unclaimed and not yet run: a claimed one is
             -- somebody else's now, and one that already happened is a
             -- button that can only fail.
             'open_sessions', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'offer_id', s.id,
                        'name', coalesce(nullif(btrim(cs.name), ''), 'A class'),
                        'starts_at', cs.starts_at
                      ) order by cs.starts_at)
                 from public.cover_request_sessions s
                 join public.class_sessions cs on cs.id = s.class_session_id
                where s.request_id = cr.id
                  and s.claimed_by is null
                  and cs.starts_at > now()
             ), '[]'::jsonb)
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
      from (
        -- The outer query takes at most v_limit rows in total, so a
        -- campaign further back than the v_limit most recent ones cannot
        -- reach the page even if every row on it were a campaign. Cutting
        -- here rather than after the aggregate is the difference between
        -- counting every send the gym has ever made and counting fifty:
        -- at five hundred campaigns and four hundred thousand recipient
        -- rows that was 381ms on the staff home screen, and it grew for
        -- ever because campaigns are never deleted.
        select c.id, c.gym_id, c.subject, c.status, c.title,
               c.delivery_tracked, c.sent_at, c.updated_at
          from public.email_campaigns c
         where v_comms
           and c.gym_id = p_gym_id
           and c.status in ('sent', 'failed', 'cancelled')
           and coalesce(c.sent_at, c.updated_at) < v_before
         order by coalesce(c.sent_at, c.updated_at) desc
         limit v_limit
      ) ec
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
$function$;

revoke all on function public.timeline_feed(uuid, timestamptz, integer)
  from public, anon;
grant execute on function public.timeline_feed(uuid, timestamptz, integer)
  to authenticated;

commit;
