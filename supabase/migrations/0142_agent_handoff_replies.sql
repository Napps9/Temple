-- Handed-off AI threads were a notification black hole: request_handoff
-- notified the coach once, but every prospect reply AFTER that was stored
-- silently (the SMS webhook correctly stops the AI on a handed_off thread,
-- and nothing else fired). "Never miss a lead" failed on exactly the leads
-- hot enough to need a human.
--
-- agent_notify_handoff_reply is called by lead-agent-sms on each inbound
-- message to a handed_off conversation. Hour-stamped idempotency key =
-- at most one email per lead per hour however fast they text; falls back
-- to the gym owner when the lead has no assigned coach so a reply is
-- never silent.

begin;

-- Lets the inbox show "waiting on you" without an extra per-row query:
-- appendMessage keeps it current alongside last_message_at.
alter table public.agent_conversations
  add column if not exists last_message_role text;

create function public.agent_notify_handoff_reply(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lead  uuid;
  v_gym   uuid;
  v_coach uuid;
begin
  select lead_id, gym_id into v_lead, v_gym
    from public.agent_conversations
    where id = p_conversation_id and status = 'handed_off';
  if v_lead is null then
    return;
  end if;

  select assigned_coach_id into v_coach from public.leads where id = v_lead;
  if v_coach is null then
    select profile_id into v_coach
      from public.gym_memberships
      where gym_id = v_gym and role = 'owner' and left_at is null
      order by created_at
      limit 1;
  end if;
  if v_coach is not null then
    perform public.enqueue_lead_notifications(
      v_lead, v_coach, 'agent-reply:' || to_char(now(), 'YYYY-MM-DD-HH24'));
  end if;
end;
$$;
revoke execute on function public.agent_notify_handoff_reply(uuid)
  from public, anon, authenticated;
grant execute on function public.agent_notify_handoff_reply(uuid)
  to service_role;

commit;
