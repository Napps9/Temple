-- Close the loop on the AI agent's close: record WHICH plan the prospect
-- agreed to, show the lead in a visible pipeline stage, and put the agreed
-- plan in front of the member at checkout time.
--
-- Before this, enroll_member/start_onboarding threw the agreed plan away
-- (the tool had no plan argument) and the lead sat in 'cold' until signup
-- completed — the board showed the hottest leads as untouched, and the new
-- member landed on a plans page with nothing preselected.
--
-- pending_members.agreed_plan_id is deliberately NOT
-- linked_membership_plan_id: that column grants an UNBILLED plan at link
-- time (member-import semantics). The agreed plan is only a pointer the
-- member pays for through normal checkout.

begin;

alter type public.lead_status add value if not exists 'committed' before 'converted';

alter table public.pending_members
  add column if not exists agreed_plan_id uuid
    references public.membership_plans(plan_id) on delete set null;

-- Arity change: drop the 3-arg version (see 0043 lesson).
drop function if exists public.agent_stage_onboarding(uuid, text, text);
create function public.agent_stage_onboarding(
  p_conversation_id uuid,
  p_full_name       text,
  p_email           text,
  p_plan_id         uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_lead     uuid;
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_plan     uuid;
  v_existing uuid;
begin
  select gym_id, lead_id into v_gym, v_lead
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null then
    raise exception 'Conversation not found';
  end if;
  if v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required to send onboarding';
  end if;

  -- Only accept a plan that really belongs to this gym and is live.
  if p_plan_id is not null then
    select plan_id into v_plan
      from public.membership_plans
      where plan_id = p_plan_id and gym_id = v_gym and archived_at is null;
  end if;

  select id into v_existing
    from public.pending_members
    where gym_id = v_gym and lower(email) = v_email
    limit 1;
  if v_existing is not null then
    update public.pending_members
      set full_name = coalesce(v_name, full_name),
          agreed_plan_id = coalesce(v_plan, agreed_plan_id),
          status = case when status = 'linked' then status else 'invited' end
      where id = v_existing;
  else
    insert into public.pending_members (gym_id, email, full_name, agreed_plan_id, status, notes)
      values (v_gym, v_email, v_name, v_plan, 'invited',
              'Staged by the AI sales agent at close');
  end if;

  -- Backfill the linked lead's email and surface the close on the board:
  -- a staged onboarding means the prospect committed, so the lead moves to
  -- 'committed' (terminal states stay put; conversion still happens at join).
  if v_lead is not null then
    update public.leads
      set email = coalesce(email, v_email),
          status = case
            when status in ('cold', 'contacted', 'intro_booked', 'trial_attended')
              then 'committed'::public.lead_status
            else status
          end,
          updated_at = now()
      where id = v_lead;
  end if;
end;
$$;
revoke execute on function public.agent_stage_onboarding(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.agent_stage_onboarding(uuid, text, text, uuid)
  to service_role;

-- Member-facing: the plan the agent staged for me, if I still need one.
-- Matched on the signed-in email; hidden as soon as any current
-- subscription exists so it never nags a paying member.
create function public.my_agreed_plan(p_gym_id uuid)
returns table (plan_id uuid, plan_name text)
language sql security definer set search_path = public
as $$
  select mp.plan_id, mp.name
  from public.pending_members pm
  join public.membership_plans mp on mp.plan_id = pm.agreed_plan_id
  where pm.gym_id = p_gym_id
    and lower(pm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and mp.archived_at is null
    and not exists (
      select 1 from public.plan_subscriptions ps
      where ps.gym_id = p_gym_id
        and ps.profile_id = auth.uid()
        and ps.status in
          ('active', 'pending', 'paused', 'cancelled_at_period_end', 'refunded_retained')
    )
  limit 1;
$$;
grant execute on function public.my_agreed_plan(uuid) to authenticated;

create function public.clear_my_agreed_plan(p_gym_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.pending_members
    set agreed_plan_id = null
    where gym_id = p_gym_id
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
grant execute on function public.clear_my_agreed_plan(uuid) to authenticated;

commit;
