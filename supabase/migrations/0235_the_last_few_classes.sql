-- 0235: The last few classes on a pack
--
-- A fifth job, stamped from the same 0206 framework. Same dial, same card,
-- same owner-approved template, same hard rules in SQL.
--
-- The gap: a member on a class pack runs it down silently. Nobody is told
-- until they try to book and cannot, by which point the gym has lost the
-- renewal and the member has had the worst possible reminder that their
-- pack existed. Renewing a pack is the easiest revenue a gym has and the
-- one most often missed, because noticing requires somebody to be watching
-- a number that only ever goes down.
--
-- FIVE HARD RULES:
--
--   1. Packs only. A credit_period plan's balance RESETS at
--      period_resets_at, so running low is what a normal month looks like
--      — messaging about it would nag somebody who has simply used their
--      allowance. Only credit_pack can actually run out.
--   2. One or two left, not zero. At zero they are already locked out and
--      the booking screen has told them; a note then is a sales nag about
--      a problem they have already met. At one or two the note has a job:
--      it stops the lockout happening.
--   3. Only somebody actually training — attended inside 21 days. That is
--      exactly retention's threshold in the other direction (it takes 21+
--      days absent), so the two jobs cannot both hold the same member. A
--      renewal nudge to somebody already drifting away is a sales nag; the
--      right job for them is the one that asks how they are.
--   4. Once per subscription per 60 days, keyed on the subscription id in
--      the payload rather than on the member. A member buys pack after
--      pack and each one legitimately runs down, so "once ever" would go
--      quiet after the first. Keyed this way it is right whether a repeat
--      purchase opens a new subscription row or tops up the existing one —
--      which is a detail this migration deliberately does not depend on.
--   5. Three a day per gym, like the rest.
--
-- One warm note from the owner-approved template. It does not sell, does
-- not change a plan and does not take a payment: the member tops up
-- through the same self-serve path they always had.

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
     'cover_ask', 'first_week_message', 'credits_low_message'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message'));

-- cover_ask is still absent here: it re-asks through the cover plumbing
-- and never mails a member, so it has no template. 0234 learned that the
-- hard way when the pgTAP file refused to seed one.
alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'first_week_message', 'credits_low_message'));

-- ============================================================================
-- 2. Switching the job on and off
-- ============================================================================

create or replace function public.set_credits_low_job(
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
    values (p_gym_id, 'credits_low_message', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'credits_low_message',
       'Hi {first_name} — it''s {gym_name}. Quick heads up: you''ve got '
       || '{credits_left} left on your {plan_name}. Top up whenever suits '
       || 'and you won''t get caught short mid-week. If something else '
       || 'would suit you better, just reply and we''ll sort it.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'credits_low_message';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'credits_low_message'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_credits_low_job(uuid, boolean) from public, anon;
grant execute on function public.set_credits_low_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 3. The executor learns one subject line and one placeholder
-- ============================================================================
--
-- Restated from 0234 with two additions, extracted verbatim and diffed
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

  v_subject := case a.action_kind
    when 'plan_adjustment_offer'
      then 'A thought about your ' || coalesce(v_gym.name, 'gym') || ' membership'
    when 'retention_message'
      then 'We''ve missed you at ' || coalesce(v_gym.name, 'the gym')
    when 'first_week_message'
      then 'Getting you started at ' || coalesce(v_gym.name, 'the gym')
    when 'credits_low_message'
      then 'Running low on classes at ' || coalesce(v_gym.name, 'the gym')
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

create or replace function public.agent_credits_low_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_action   uuid;
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
-- 5. Schedule
-- ============================================================================
--
-- 09:45, after retention at 08:45 and the first week at 09:15. The three
-- daily member-facing jobs run in the order an owner would notice them,
-- and each has its own cap, so a busy morning cannot crowd one out.

select cron.schedule(
  'agent-credits-low-tick',
  '45 9 * * *',
  $$select public.agent_credits_low_tick();$$
);

commit;
