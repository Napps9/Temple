-- 0241: A pack that costs more than a membership
--
-- A sixth job, stamped from the same 0206 framework. Same dial, same card,
-- same owner-approved template, same hard rules in SQL.
--
-- The gap: a member who trains a lot on a class pack is paying the worst
-- price in the building. Every pack they buy costs more per class than the
-- membership sitting next to it in the same catalogue, and nobody tells
-- them, because noticing means somebody dividing one number by another for
-- every member every month. The gym looks expensive, the member churns
-- eventually, and the recurring revenue that would have been the easiest
-- to keep never starts.
--
-- WHEN IT FIRES IS THE WHOLE DESIGN. It fires at the exact moment
-- credits_low_message fires — a pack down to its last one or two — because
-- that is the moment the member is about to spend money again, and the
-- only moment this is help rather than a sales pitch. So it does not
-- compete with the top-up nudge, it REPLACES it: one message that says
-- both "you are running low" and "there is a cheaper way", which is
-- strictly better than two that contradict each other. 0235's tick gains
-- one exclusion at the bottom of this migration and nothing else.
--
-- SIX HARD RULES:
--
--   1. A pack down to one or two, trained inside 21 days — credits_low's
--      rules 1, 2 and 3 exactly, for credits_low's reasons. Sharing the
--      trigger is what lets one message do both jobs.
--   2. The arithmetic has to actually favour them. What they trained in
--      the last 30 days, times what a class costs them on this pack,
--      against the gym's cheapest live recurring plan. If the pack wins,
--      this job stays quiet and the top-up nudge is the right message.
--   3. The alternative has to cover them. An `unlimited` plan always
--      does. A `credit_period` plan only if its credit_count is at least
--      what they trained — otherwise "cheaper" is only true until they
--      run out again in week three, which is the same trap in a nicer
--      wrapper.
--   4. A margin worth a message: a fifth of what they are spending AND
--      more than the price of one class. Below that this is a nag about
--      rounding, and a member who switches to save eighty pence resents
--      being asked.
--   5. Once per member per 180 days, not per subscription. "You would be
--      better off on a membership" does not change from one pack to the
--      next, so keying it per subscription would repeat it every few
--      weeks. A rejection is therefore final for six months, which is
--      right: the owner has already answered.
--   6. Three a day per gym, like the rest.
--
-- The message offers and does not take. It changes no plan and moves no
-- money — the member switches through the same self-serve path they always
-- had, or replies, and the pack they already paid for keeps working
-- whatever they decide.

begin;

-- ============================================================================
-- 1. Widen the framework's kind vocabularies
-- ============================================================================

alter table public.agent_actions
  drop constraint agent_actions_action_kind_check;
alter table public.agent_actions
  add constraint agent_actions_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer'));

-- cover_ask is still the only kind absent here: it re-asks through the
-- cover plumbing and never mails a member, so it has no template.
alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'first_week_message', 'credits_low_message', 'plan_upgrade_offer'));

-- ============================================================================
-- 2. Switching the job on and off
-- ============================================================================

create or replace function public.set_plan_upgrade_job(
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
    values (p_gym_id, 'plan_upgrade_offer', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'plan_upgrade_offer',
       'Hi {first_name} — it''s {gym_name}. You''ve got {credits_left} left '
       || 'on your {plan_name}. Looking at how often you''ve been in lately, '
       || '{offer_plan} at {offer_price} a month would work out cheaper than '
       || 'buying another pack — around {upgrade_saving} a month better off. '
       || 'Want us to switch you over? No rush either way, and the classes '
       || 'you''ve already paid for still stand.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'plan_upgrade_offer';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'plan_upgrade_offer'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_plan_upgrade_job(uuid, boolean) from public, anon;
grant execute on function public.set_plan_upgrade_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 3. The executor learns one subject line and one placeholder
-- ============================================================================
--
-- Restated from 0235 with two additions, extracted verbatim and diffed
-- rather than rewritten from memory: this is the one path by which any
-- job's approved action reaches a member, and a branch lost here is a job
-- that silently sends nothing.

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

  if a.action_kind = 'cover_ask' then
    perform public._agent_cover_reask((a.payload->>'request_id')::uuid);
    update public.agent_actions
      set status = 'executed', executed_at = now()
      where id = a.id;
    return;
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
  -- Written out in the tick as "1 class" or "2 classes", so the template
  -- never has to do arithmetic or guess at a plural.
  v_body := replace(v_body, '{credits_left}',
    coalesce(a.payload->>'credits_left_phrase', 'a couple of classes'));
  -- Likewise already formatted in the gym's currency by the tick.
  v_body := replace(v_body, '{upgrade_saving}',
    coalesce(a.payload->>'upgrade_saving', 'a bit'));

  v_subject := case a.action_kind
    when 'plan_adjustment_offer'
      then 'A thought about your ' || coalesce(v_gym.name, 'gym') || ' membership'
    when 'retention_message'
      then 'We''ve missed you at ' || coalesce(v_gym.name, 'the gym')
    when 'first_week_message'
      then 'Getting you started at ' || coalesce(v_gym.name, 'the gym')
    when 'credits_low_message'
      then 'Running low on classes at ' || coalesce(v_gym.name, 'the gym')
    when 'plan_upgrade_offer'
      then 'A cheaper way to train at ' || coalesce(v_gym.name, 'the gym')
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
-- 4. The tick — daily
-- ============================================================================

create or replace function public.agent_plan_upgrade_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.agent_plan_upgrade_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 5. The top-up nudge steps aside
-- ============================================================================
--
-- 0235's tick restated with one addition, extracted verbatim and diffed.
-- Without it the same member gets "top up your pack" five minutes after
-- "a membership would cost you less than another pack", and the second
-- message makes the first one look like the gym was not paying attention.
--
-- Narrow on purpose. Only a proposal that is still live or already sent
-- suppresses it, so an owner who REJECTS the upgrade gets the top-up nudge
-- back on tomorrow's tick rather than losing it for sixty days over an
-- answer they gave in the other direction.

create or replace function public.agent_credits_low_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.agent_credits_low_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 6. Schedule
-- ============================================================================
--
-- 09:40, five minutes ahead of credits-low at 09:45. The order is the
-- point rather than the spacing: the exclusion in section 5 reads rows
-- this tick has already written, so on any morning both would fire, the
-- better message is the one that exists first.

select cron.schedule(
  'agent-plan-upgrade-tick',
  '40 9 * * *',
  $$select public.agent_plan_upgrade_tick();$$
);

commit;
