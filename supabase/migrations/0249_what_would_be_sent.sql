-- 0249: What would be sent
--
-- The story page shows the draft before the yes. The only renderer
-- today is _agent_execute_action, which demands an approved action and
-- writes the outbound queue — reading the draft through it would mean
-- sending it. payment_chase_preview is the same substitution, read-only:
-- same template, same placeholder fills, same subject line, so what the
-- owner reads is what would be sent.
--
-- No chase_message template means the job was never taken on. That is
-- an answer, not an error: there is no draft to show, so the function
-- returns zero rows.

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
  select p.full_name into v_member
    from public.profiles p where p.id = v_dn.profile_id;
  select mp.name into v_plan
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    where ps.id = p_subscription_id;

  v_first := split_part(coalesce(v_member, 'there'), ' ', 1);

  v_body := replace(v_template, '{first_name}', v_first);
  v_body := replace(v_body, '{gym_name}', coalesce(v_gym_name, 'your gym'));
  v_body := replace(v_body, '{plan_name}', coalesce(v_plan, 'membership'));

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
