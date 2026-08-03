-- 0248: Chase this one for me
--
-- The "Needs chasing" list shows who is failing and leaves the owner two
-- moves: message the member yourself, or wait for the revenue tick to
-- raise its hand in the Timeline — three days after the failure, and only
-- as a question that then waits for a yes. There is no way to hand a case
-- to the teammate while you are looking at it.
--
-- request_payment_chase is that handover. It is not a new kind of act:
-- it joins (or opens) the same case the tick would, writes the same
-- chase_message action with the same payload and evidence, and sends it
-- through _agent_execute_action — same owner-approved template, same
-- outbound queue, same quiet hours and suppressions. The one difference
-- is the decision. The caller holds can_see_money, the exact capability
-- decide_agent_action accepts a yes from, so the action is born approved
-- with the tapper as decided_by and the Timeline shows a receipt, not a
-- question. The authority dial is deliberately not consulted: the dial
-- rations the agent's initiative, and this is the owner's.
--
-- The agent's own guardrails still bind. The job must be switched on
-- (authority row and template both come from set_money_job), the
-- two-touch cap counts this touch, and a chase the tick already proposed
-- becomes this yes instead of a second email — a case never carries two
-- open chases.

begin;

create or replace function public.request_payment_chase(
  p_gym_id uuid,
  p_subscription_id uuid
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
      set status = 'approved', decided_by = auth.uid(), decided_at = now()
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
     ),
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

revoke all on function public.request_payment_chase(uuid, uuid)
  from public, anon;
grant execute on function public.request_payment_chase(uuid, uuid)
  to authenticated;

commit;
