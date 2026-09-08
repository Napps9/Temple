-- Chase for me sent the nudge on the tap. The detail page showed the
-- text underneath, but the button did not stop on it, the Timeline row
-- and the Needs chasing list never showed it at all, and the only way to
-- change a word for one member was to change the template for everyone.
-- Now the draft is the editor: request_payment_chase takes the subject
-- and body the owner pressed Send on, stores them on the action's
-- payload as subject_override and body_override, the executor sends
-- those over the template render, and the preview hands a stored edit
-- back so a reload shows what will go. No edit means exactly what went
-- before. The arity changes, so the function is dropped and recreated.

begin;

drop function public.request_payment_chase(uuid, uuid);

create function public.request_payment_chase(
  p_gym_id          uuid,
  p_subscription_id uuid,
  p_subject         text default null,
  p_body            text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dn        record;
  v_member    record;
  v_requester record;
  v_plan      record;
  v_currency  text;
  v_case      uuid;
  v_pending   uuid;
  v_touches   integer;
  v_action    uuid;
  v_overrides jsonb := '{}'::jsonb;
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

  perform 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_dn.profile_id
      and gm.left_at is null;
  if not found then
    raise exception 'That member has left';
  end if;

  -- The owner's edits to this one nudge. Whitespace is no edit; a
  -- bound keeps a pasted novel out of an email subject.
  if length(btrim(coalesce(p_subject, ''))) > 0 then
    v_overrides := v_overrides
      || jsonb_build_object('subject_override', left(btrim(p_subject), 200));
  end if;
  if length(btrim(coalesce(p_body, ''))) > 0 then
    v_overrides := v_overrides
      || jsonb_build_object('body_override', left(btrim(p_body), 4000));
  end if;

  if not exists (select 1 from public.agent_authority
                  where gym_id = p_gym_id
                    and action_kind = 'chase_message') then
    raise exception 'The money job is not switched on';
  end if;

  select id into v_case
    from public.agent_cases
    where plan_subscription_id = p_subscription_id and stage <> 'closed';
  if v_case is null then
    insert into public.agent_cases (gym_id, plan_subscription_id, profile_id)
    values (p_gym_id, p_subscription_id, v_dn.profile_id)
    returning id into v_case;
  end if;

  -- Same hard cap as the tick: two agent touches per case, ever — and
  -- this one counts.
  select count(*) into v_touches
    from public.agent_actions
    where case_id = v_case and status in ('approved', 'executed');
  if v_touches >= 2 then
    raise exception 'Already chased twice';
  end if;

  select id into v_pending
    from public.agent_actions
    where case_id = v_case
      and action_kind = 'chase_message'
      and status = 'proposed'
    limit 1;
  if v_pending is not null then
    update public.agent_actions
      set status = 'approved', decided_by = auth.uid(), decided_at = now(),
          payload = payload || v_overrides
      where id = v_pending;
    perform public._agent_execute_action(v_pending);
    return v_pending;
  end if;

  select p.full_name into v_member
    from public.profiles p where p.id = v_dn.profile_id;
  select p.full_name into v_requester
    from public.profiles p where p.id = auth.uid();
  select g.currency into v_currency
    from public.gyms g where g.id = p_gym_id;
  select mp.name, coalesce(ps.price_cents, mp.monthly_price_cents) as price_cents
    into v_plan
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    where ps.id = p_subscription_id;

  insert into public.agent_actions
    (gym_id, teammate, action_kind, subject_profile, subject_subscription,
     case_id, payload, evidence, status, decided_by, decided_at)
  values
    (p_gym_id, 'revenue', 'chase_message', v_dn.profile_id, p_subscription_id,
     v_case,
     jsonb_build_object(
       'member_name', coalesce(v_member.full_name, 'A member'),
       'plan_name', coalesce(v_plan.name, 'membership')
     ) || v_overrides,
     jsonb_build_array(
       'Payment has failed ' || v_dn.payment_failure_count || ' time'
         || case when v_dn.payment_failure_count = 1 then '' else 's' end
         || ' since ' || to_char(v_dn.past_due_since, 'DD Mon'),
       case when v_dn.next_payment_attempt is null
         then 'Stripe has stopped retrying.'
         else 'Stripe will try again on '
           || to_char(v_dn.next_payment_attempt, 'DD Mon') || '.' end,
       'On ' || coalesce(v_plan.name, 'their plan')
         || case when v_plan.price_cents is not null
            then ' at ' || public.money_text(v_plan.price_cents, v_currency)
                 || ' a month.'
            else '.' end,
       'Requested by ' || coalesce(v_requester.full_name, 'a staff member')
         || ' from the Needs chasing list.'
     ),
     'approved', auth.uid(), now())
  returning id into v_action;

  perform public._agent_execute_action(v_action);
  return v_action;
end;
$$;

revoke all on function public.request_payment_chase(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.request_payment_chase(uuid, uuid, text, text)
  to authenticated;

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
      and a.status in ('proposed', 'approved')
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

  -- The owner read the draft and changed it (0284): their words go,
  -- not the template's.
  v_subject := coalesce(a.payload->>'subject_override', v_subject);
  v_body    := coalesce(a.payload->>'body_override', v_body);

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
