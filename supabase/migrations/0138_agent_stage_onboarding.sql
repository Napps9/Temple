-- AI sales agent — pre-fill a new member's onboarding at close.
--
-- When the agent closes a membership on a call/text, it stages the member's
-- identity so their sign-up is pre-filled and their onboarding is ready to
-- complete. This does NOT sign anything: the member still creates their own
-- account, signs the waiver, and answers the PAR-Q themselves through the
-- normal entry gate (waiver/PAR-Q signatures are RLS-locked to auth.uid(), so
-- the agent structurally cannot pre-sign — by design).
--
-- Mechanism: reuse the existing pending_members staging table (0046/0076).
-- Staging a row keyed on (gym_id, lower(email)) means that when the member
-- signs up at /join/<slug> with the same email, apply_pending_member_data
-- links their record and _auto_attribute_lead_on_join converts the lead —
-- all automatically. We deliberately do NOT set linked_membership_plan_id
-- (that path grants an UNBILLED plan, meant for imports); a new paying member
-- pays through the normal checkout after joining.
--
-- Service-role only, tenancy derived from the conversation row — same shape
-- as agent_capture_lead (0136); never trusts a caller-supplied gym id.

begin;

create or replace function public.agent_stage_onboarding(
  p_conversation_id uuid,
  p_full_name       text,
  p_email           text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_lead     uuid;
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_existing uuid;
begin
  select gym_id, lead_id into v_gym, v_lead
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null then
    raise exception 'Conversation not found';
  end if;
  -- A valid email is required: it is the key the signup match links on and
  -- the address we send the onboarding link to.
  if v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required to send onboarding';
  end if;

  select id into v_existing
    from public.pending_members
    where gym_id = v_gym and lower(email) = v_email
    limit 1;
  if v_existing is not null then
    update public.pending_members
      set full_name = coalesce(v_name, full_name),
          status = case when status = 'linked' then status else 'invited' end
      where id = v_existing;
  else
    insert into public.pending_members (gym_id, email, full_name, status, notes)
      values (v_gym, v_email, v_name, 'invited',
              'Staged by the AI sales agent at close');
  end if;

  -- Backfill the linked lead's email so join-time attribution links them.
  if v_lead is not null then
    update public.leads
      set email = coalesce(email, v_email), updated_at = now()
      where id = v_lead;
  end if;
end;
$$;
revoke execute on function public.agent_stage_onboarding(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_stage_onboarding(uuid, text, text)
  to service_role;

commit;
