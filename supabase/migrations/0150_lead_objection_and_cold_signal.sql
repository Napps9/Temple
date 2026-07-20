-- Objection handling + the cold-lead signal.
--
-- The AI front desk captured leads but had no way to record WHY one
-- hesitated, and a lead that engaged then went quiet sat in its stage
-- forever — nobody chased it. Two columns and three functions close that:
--
--   leads.objection    — the last concern the agent captured (price, time,
--                        nerves, comparing gyms). Short, non-medical — health
--                        concerns still go through flag_health_mention only.
--   leads.follow_up_at  — when to next chase this lead. <= now() means "chase
--                        now" and is what the board surfaces as the cold
--                        signal. Set by the agent on a deferral/decline and
--                        by the nightly stale sweep; cleared when staff act.
--
-- agent_record_objection (service role): the log_objection tool. Records the
-- reason and where the prospect landed. 'deferred' schedules a chase in 3
-- days; 'declined' flags it due now AND pings a human, because a warm lead
-- cooling is exactly what "never miss a lead" must catch — but it is never
-- auto-marked 'lost'; that stays a human judgement.
--
-- flag_stale_leads (cron): any un-converted, un-flagged lead with no activity
-- for 7 days (no lead edit and no inbound message) becomes due and its coach
-- is notified. set_lead_status clears follow_up_at so acting on a card retires
-- the chase.

begin;

alter table public.leads
  add column if not exists objection   text,
  add column if not exists follow_up_at timestamptz;

create index if not exists leads_follow_up_idx
  on public.leads(gym_id, follow_up_at) where follow_up_at is not null;

create function public.agent_record_objection(
  p_conversation_id uuid,
  p_reason          text,
  p_intent          text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym    uuid;
  v_lead   uuid;
  v_coach  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_intent text := lower(coalesce(p_intent, 'considering'));
begin
  select gym_id, lead_id into v_gym, v_lead
    from public.agent_conversations where id = p_conversation_id;
  if v_lead is null then
    return;
  end if;
  if v_intent not in ('considering', 'deferred', 'declined') then
    v_intent := 'considering';
  end if;

  update public.leads
    set objection = coalesce(left(v_reason, 300), objection),
        follow_up_at = case v_intent
          when 'deferred' then now() + interval '3 days'
          when 'declined' then now()
          else follow_up_at
        end
    where id = v_lead;

  if v_intent = 'declined' then
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
        v_lead, v_coach, 'lead-cooled:' || to_char(now(), 'YYYY-MM-DD'));
    end if;
  end if;
end;
$$;
revoke execute on function public.agent_record_objection(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_record_objection(uuid, text, text)
  to service_role;

create function public.flag_stale_leads()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
  r       record;
  v_coach uuid;
begin
  for r in
    with due as (
      update public.leads l
        set follow_up_at = now()
        where l.status not in ('converted'::public.lead_status, 'lost'::public.lead_status)
          and l.follow_up_at is null
          and l.archived_at is null
          and l.captured_at < now() - interval '7 days'
          and l.updated_at  < now() - interval '7 days'
          and not exists (
            select 1
            from public.agent_conversations c
            join public.agent_messages m on m.conversation_id = c.id
            where c.lead_id = l.id and m.created_at > now() - interval '7 days'
          )
        returning l.id, l.gym_id, l.assigned_coach_id
    )
    select * from due
  loop
    v_coach := r.assigned_coach_id;
    if v_coach is null then
      select profile_id into v_coach
        from public.gym_memberships
        where gym_id = r.gym_id and role = 'owner' and left_at is null
        order by created_at
        limit 1;
    end if;
    if v_coach is not null then
      perform public.enqueue_lead_notifications(
        r.id, v_coach, 'stale-lead:' || to_char(now(), 'YYYY-MM-DD'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.flag_stale_leads()
  from public, anon, authenticated;

select cron.schedule(
  'flag-stale-leads',
  '15 5 * * *', -- daily 05:15 UTC, off the 04:00/04:30 agent sweeps
  $$select public.flag_stale_leads();$$
);

-- Acting on a lead retires the chase. Same body as 0067 plus follow_up_at.
create or replace function public.set_lead_status(
  p_lead_id              uuid,
  p_status               public.lead_status,
  p_converted_profile_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym_id from public.leads where id = p_lead_id;
  if v_gym_id is null then
    raise exception 'Lead not found';
  end if;
  if not public.user_can_assign_plan(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  if p_status = 'converted' then
    if p_converted_profile_id is null then
      raise exception 'A member profile is required to mark a lead converted';
    end if;
    if not exists (
      select 1 from public.gym_memberships
      where gym_id = v_gym_id and profile_id = p_converted_profile_id
    ) then
      raise exception 'The converted profile is not a member of this gym';
    end if;
    update public.leads
      set status               = p_status,
          converted_at         = coalesce(converted_at, now()),
          converted_profile_id = p_converted_profile_id,
          follow_up_at         = null
      where id = p_lead_id;
  else
    update public.leads
      set status               = p_status,
          converted_at         = null,
          converted_profile_id = null,
          follow_up_at         = null
      where id = p_lead_id;
  end if;
end;
$$;
grant execute on function public.set_lead_status(uuid, public.lead_status, uuid)
  to authenticated;

commit;
