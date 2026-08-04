-- 0250: The draft is the send
--
-- 0249 promised that what the owner reads is what would be sent. The
-- promise held only for the seeded template and only when no proposal
-- was pending. Two ways it broke: the preview filled just {first_name},
-- {gym_name} and {plan_name}, so a template edited to use {offer_plan},
-- {offer_price}, {credits_left} or {upgrade_saving} previewed with the
-- braces still in while the executor (0246) fills all seven; and when
-- the revenue tick had already proposed a chase for the case,
-- request_payment_chase (0248) turns that proposal into the send — the
-- executor renders from the proposal's payload, member_name captured at
-- tick time — while the preview read live profiles.full_name. A member
-- renamed between tick and tap previewed under the new name and was
-- emailed under the old one.
--
-- Same signature, same guards. The preview now reads the pending
-- chase's payload when the open case carries one — that is literally
-- the action request_payment_chase would execute — falls back to the
-- live lookups otherwise, and applies every replace the executor
-- applies, with the executor's exact fallbacks.

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

  return query select v_subject, v_body;
end;
$$;

revoke all on function public.payment_chase_preview(uuid, uuid)
  from public, anon;
grant execute on function public.payment_chase_preview(uuid, uuid)
  to authenticated;

commit;
