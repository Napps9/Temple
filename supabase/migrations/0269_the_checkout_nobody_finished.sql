-- The checkout nobody finished
--
-- Somebody reaches the payment page, gets as far as their card, and stops.
-- Today nothing happens: Temple never learns they were there. checkout
-- sessions are created and forgotten, the webhook only ever hears about
-- the ones that succeed, and the gym loses a member who was one tap from
-- joining without ever knowing there was somebody to chase.
--
-- THE ROW HAS TO EXIST BEFORE THE JOB CAN SEE IT. stripe-checkout writes
-- a checkout_attempts row before it hands back the URL, the webhook stamps
-- completed_at on the session it already handles, and a new expired branch
-- stamps expired_at. The tick depends on NEITHER arriving: abandoned means
-- "created more than two hours ago and never completed", so a webhook that
-- is late, retried, or lost cannot make a real abandonment invisible.
--
-- A JOB, NOT AN EMAIL AUTOMATION. Every branch of enqueue_due_automation_runs
-- joins comms_audience_rows on all_members, and somebody who abandoned a
-- checkout may hold no active membership at all — so the automation route
-- needs a new audience kind as well as a new trigger, and still has no
-- proposal card. Recovering a payment is a money job. Building both would
-- mean two systems proposing the same nudge and the member getting it
-- twice.
--
-- IT IS NOT IN THE SHARED ASK BUDGET. _agent_ask_budget_left rations the
-- five kinds where the gym is NOTICING something and a day later is the
-- same message. This is neither: the intent is hours old, the session that
-- carried it has already expired, and chase_message — the other money kind
-- — has always been exempt for the same reason. It gets its own cap of
-- three a day instead, so a gym that has just opened its join link does not
-- wake up to a queue.
--
-- AND THE MESSAGE NEVER CARRIES THE STRIPE URL. A checkout session dies
-- with its expires_at, which stripe-checkout now sets to an hour, so a link
-- in an email that arrives two hours later is a dead link and a worse
-- experience than silence. The template points at the gym's plans in the
-- app, which mints a fresh session.

begin;

-- ============================================================================
-- 1. The attempt
-- ============================================================================

create table public.checkout_attempts (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  plan_id            uuid references public.membership_plans(plan_id) on delete set null,
  stripe_session_id  text not null unique,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  expired_at         timestamptz
);

create index checkout_attempts_open_idx
  on public.checkout_attempts(gym_id, created_at)
  where completed_at is null;

comment on table public.checkout_attempts is
  'One row per membership Checkout Session, written before the redirect. '
  'completed_at is stamped by the webhook; the recovery tick does not '
  'depend on it arriving — an abandonment is an uncompleted attempt older '
  'than two hours.';

alter table public.checkout_attempts enable row level security;

-- Money, so the money capability. Written by the service role only.
create policy checkout_attempts_money_select on public.checkout_attempts
  for select using (public.effective_can(gym_id, 'can_see_money'));

-- ============================================================================
-- 2. The framework's vocabularies take a ninth kind
-- ============================================================================

alter table public.agent_actions
  drop constraint agent_actions_action_kind_check;
alter table public.agent_actions
  add constraint agent_actions_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer', 'class_return_message',
     'checkout_recovery_message'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer', 'class_return_message',
     'checkout_recovery_message'));

-- The third one. 0234's header says why it matters: a job whose template
-- cannot be stored raises "No approved template" the first time an owner
-- approves it, which is the worst possible moment to find out.
alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'first_week_message', 'credits_low_message', 'plan_upgrade_offer',
     'class_return_message', 'checkout_recovery_message'));

-- ============================================================================
-- 3. Switching it on and off
-- ============================================================================

create or replace function public.set_checkout_recovery_job(
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
    values (p_gym_id, 'checkout_recovery_message', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'checkout_recovery_message',
       'Hi {first_name} — it''s {gym_name}. You started signing up for '
       || '{plan_name} and didn''t get to the end, which usually means the '
       || 'card machine got in the way rather than that you changed your '
       || 'mind. Your place is still here whenever you want it — open the '
       || 'app and pick your plan, or reply and we''ll sort it with you.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'checkout_recovery_message';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'checkout_recovery_message'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_checkout_recovery_job(uuid, boolean) from public, anon;
grant execute on function public.set_checkout_recovery_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 4. The executor learns one more subject line
-- ============================================================================
--
-- Extracted from the live database with pg_get_functiondef and diffed
-- rather than rewritten from memory, per 0234: this is the one path by
-- which any job's approved action reaches a member, and a branch lost here
-- is a job that silently sends nothing. The only change is one `when` arm.

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
  r         jsonb;
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

  if a.action_kind = 'class_return_message' then
    v_subject := 'The ' || coalesce(a.payload->>'class_label', 'class')
      || ' at ' || coalesce(v_gym.name, 'the gym');
    for r in
      select value from jsonb_array_elements(coalesce(a.payload->'recipients', '[]'::jsonb))
    loop
      v_body := replace(t.body, '{first_name}',
        split_part(coalesce(r->>'name', 'there'), ' ', 1));
      v_body := replace(v_body, '{gym_name}', coalesce(v_gym.name, 'your gym'));
      v_body := replace(v_body, '{class_name}',
        coalesce(a.payload->>'class_label', 'your usual class'));
      insert into public.agent_outbound_messages
        (gym_id, case_id, action_id, recipient_profile_id, subject, body,
         idempotency_key)
      values
        (a.gym_id, a.case_id, a.id, (r->>'profile_id')::uuid, v_subject, v_body,
         'agent-action:' || a.id || ':' || (r->>'profile_id'))
      on conflict (idempotency_key) do nothing;
    end loop;
    update public.agent_actions
      set status = 'executed', executed_at = now()
      where id = a.id;
    return;
  end if;

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
    when 'checkout_recovery_message'
      then 'Finishing up at ' || coalesce(v_gym.name, 'the gym')
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
-- 5. The tick — hourly
-- ============================================================================
--
-- FOUR HARD RULES, IN SQL RATHER THAN IN COPY:
--
--   1. Two to twenty-four hours after the attempt. Before two, they may
--      still be finishing, or paying on another device. After a day this
--      stops being a nudge and becomes a gym that watched somebody hesitate
--      and waited a week to mention it.
--   2. Never somebody who is now paying. completed_at not arriving is not
--      proof they did not pay — they may have gone round again, or been put
--      on a plan by hand — so the live subscription is what decides.
--   3. Once per member per plan, ever. "You didn't finish signing up" does
--      not change on the second telling, and a rejection is therefore final
--      for that pair, which is right: the owner already answered.
--   4. Three a day per gym.

create or replace function public.agent_checkout_recovery_tick()
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
  v_hours    integer;
begin
  for m in
    select ca.gym_id, ca.profile_id, ca.plan_id, ca.created_at,
           p.full_name, mp.name as plan_name, a.level
      from public.agent_authority a
      join public.checkout_attempts ca on ca.gym_id = a.gym_id
      join public.gym_memberships gm
        on gm.gym_id = ca.gym_id and gm.profile_id = ca.profile_id
       and gm.left_at is null
      join public.profiles p on p.id = ca.profile_id
      left join public.membership_plans mp on mp.plan_id = ca.plan_id
      where a.action_kind = 'checkout_recovery_message' and a.level <> 'reserved'
        and ca.completed_at is null
        -- Rule 1.
        and ca.created_at
              between now() - interval '24 hours' and now() - interval '2 hours'
        -- Rule 2. The live subscription decides, not the webhook.
        and not exists (select 1 from public.plan_subscriptions ps
                         where ps.gym_id = ca.gym_id
                           and ps.profile_id = ca.profile_id
                           and ps.status = 'active')
        -- Rule 3. Once per member per plan, ever.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = ca.gym_id
                           and aa.subject_profile = ca.profile_id
                           and aa.action_kind = 'checkout_recovery_message'
                           and coalesce(aa.payload->>'plan_id', '')
                                 = coalesce(ca.plan_id::text, ''))
      order by ca.created_at
  loop
    -- Rule 4.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'checkout_recovery_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_hours := greatest(1, floor(extract(epoch from now() - m.created_at)
      / 3600)::integer);

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'revenue', 'checkout_recovery_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'plan_name', coalesce(m.plan_name, 'a membership'),
         'plan_id', m.plan_id,
         'hours_since', v_hours
       ),
       jsonb_build_array(
         'Started checking out for ' || coalesce(m.plan_name, 'a membership')
           || ' ' || v_hours || ' hour'
           || case when v_hours = 1 then '' else 's' end || ' ago.',
         'Did not finish paying.',
         'Has no active membership.'
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

  perform public._log_cron_run('agent-checkout-recovery-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$$;

revoke all on function public.agent_checkout_recovery_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 6. Schedule
-- ============================================================================
--
-- Hourly at :20, because the window this job works in is two hours wide at
-- its narrowest and a daily tick would miss most of it entirely. :20 keeps
-- it off the quarter-hours the dispatchers own — dispatch_plan_changes now
-- runs */15 — and away from the 08:45 and 09:15 daily ticks.

select cron.schedule(
  'agent-checkout-recovery-tick',
  '20 * * * *',
  $$select public.agent_checkout_recovery_tick();$$
);

commit;
