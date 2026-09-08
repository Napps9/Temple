-- 0284 promised that a reload shows what will actually go, and did not
-- deliver it. payment_chase_preview looks for the chase on the open case and
-- read only 'proposed' or 'approved' rows — but request_payment_chase stores
-- the owner's edit and calls _agent_execute_action in the same statement, and
-- that sets 'executed'. So an override only ever existed on a row the preview
-- could not see, its two coalesce lines were unreachable, and after a reload
-- the page showed the template render under the heading "The nudge on its way
-- to <name>". In session it looked right only because the edit was still in
-- React state. The owner was being shown a record of a billing email that was
-- not what the member received.
--
-- Also gates the executor's override on chase_message. Nothing else writes
-- those keys today, and the tick rebuilds its payload rather than carrying one
-- forward, so this changes no behaviour — but the invariant that made it safe
-- lived in a different function from the code relying on it.
--
-- One thing accepted rather than fixed: the edit rides on can_see_money, the
-- capability 0248 chose because it is what decide_agent_action takes a yes
-- from. That is owner-only by default and a gym can grant it to a manager, so
-- a manager can now send a member free text under the gym's name rather than
-- only the approved template. Deliberate, and named here so the next reader
-- does not have to infer it.

begin;

create or replace function public.payment_chase_preview(
  p_gym_id uuid,
  p_subscription_id uuid
) returns table(subject text, body text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dn       record;
  v_template text;
  v_gym_name text;
  v_payload  jsonb;
  v_member   text;
  v_plan     text;
  v_first    text;
  v_subject  text;
  v_body     text;
begin
  if not public.effective_can(p_gym_id, 'can_see_money') then
    raise exception 'Not allowed';
  end if;

  -- The dunning row's presence IS the live failure (0174/0176); the
  -- gym_id filter also stops a real subscription id from another gym
  -- learning anything beyond "not failing here".
  select dn.* into v_dn
    from public.plan_subscription_dunning dn
    where dn.plan_subscription_id = p_subscription_id
      and dn.gym_id = p_gym_id;
  if not found then
    raise exception 'That payment is not failing';
  end if;

  select t.body into v_template
    from public.agent_message_templates t
    where t.gym_id = p_gym_id and t.kind = 'chase_message';
  if v_template is null then
    return;
  end if;

  select g.name into v_gym_name
    from public.gyms g where g.id = p_gym_id;

  -- A chase already waiting on the open case is the one
  -- request_payment_chase would approve and execute, so its payload —
  -- not a live lookup — is what the executor would render.
  select a.payload into v_payload
    from public.agent_actions a
    join public.agent_cases c on c.id = a.case_id
    where c.plan_subscription_id = p_subscription_id
      and c.stage <> 'closed'
      and a.action_kind = 'chase_message'
      and a.status in ('proposed', 'approved', 'executed')
    -- 'executed' is the state a sent chase is actually in: 0284 stored the
    -- owner's edit and called the executor in one statement, so an override
    -- has never existed on a row this lookup could see. Ordering because a
    -- closed-over case can hold two candidates and limit 1 would pick either.
    order by a.decided_at desc nulls last, a.proposed_at desc
    limit 1;

  if v_payload is not null then
    v_member := v_payload->>'member_name';
    v_plan   := v_payload->>'plan_name';
  else
    select p.full_name into v_member
      from public.profiles p where p.id = v_dn.profile_id;
    select mp.name into v_plan
      from public.plan_subscriptions ps
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where ps.id = p_subscription_id;
  end if;

  v_first := split_part(coalesce(v_member, 'there'), ' ', 1);

  v_body := replace(v_template, '{first_name}', v_first);
  v_body := replace(v_body, '{gym_name}', coalesce(v_gym_name, 'your gym'));
  v_body := replace(v_body, '{plan_name}', coalesce(v_plan, 'membership'));
  v_body := replace(v_body, '{offer_plan}',
    coalesce(v_payload->>'offer_plan_name', 'a smaller plan'));
  v_body := replace(v_body, '{offer_price}',
    coalesce(v_payload->>'offer_price', ''));
  v_body := replace(v_body, '{credits_left}',
    coalesce(v_payload->>'credits_left_phrase', 'a couple of classes'));
  v_body := replace(v_body, '{upgrade_saving}',
    coalesce(v_payload->>'upgrade_saving', 'a bit'));

  v_subject := 'About your ' || coalesce(v_gym_name, 'gym')
    || ' membership payment';

  -- An edit the owner already made to a waiting chase is what will go.
  v_subject := coalesce(v_payload->>'subject_override', v_subject);
  v_body    := coalesce(v_payload->>'body_override', v_body);

  return query select v_subject, v_body;
end;
$$;

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

  -- The owner read the draft and changed it (0284): their words go, not the
  -- template's. Gated on the kind rather than trusting that only chases carry
  -- the keys: that invariant lives in request_payment_chase, and one future
  -- payload merge elsewhere would otherwise put a chase's edited words, and
  -- its subject line, on a plan-adjustment offer.
  if a.action_kind = 'chase_message' then
    v_subject := coalesce(a.payload->>'subject_override', v_subject);
    v_body    := coalesce(a.payload->>'body_override', v_body);
  end if;

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

commit;
