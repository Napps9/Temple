-- Close a collision between the AI agent's close and member import: both
-- stage through pending_members keyed on (gym, lower(email)). An imported
-- row can carry linked_membership_plan_id, which grants an UNBILLED plan
-- at link time (import semantics for members who already paid elsewhere).
-- A prospect the agent closes must pay through checkout — if their email
-- matches an old imported row (a returning ex-member is the common case),
-- staging must clear that link or they'd inherit a free plan.
-- CREATE OR REPLACE, same signature as 0141 — body-only change.

begin;

create or replace function public.agent_stage_onboarding(
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
          linked_membership_plan_id = null,
          status = case when status = 'linked' then status else 'invited' end
      where id = v_existing;
  else
    insert into public.pending_members (gym_id, email, full_name, agreed_plan_id, status, notes)
      values (v_gym, v_email, v_name, v_plan, 'invited',
              'Staged by the AI sales agent at close');
  end if;

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

commit;
