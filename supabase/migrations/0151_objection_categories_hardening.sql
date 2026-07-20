-- Hardening for objection handling (0150), from an adversarial review.
--
-- The big one: leads.objection was free text the model filled, which could
-- capture special-category health data ("nervous about my knee") into a lead
-- field that sits OUTSIDE every erasure/audit path and renders on the staff
-- board — the exact Article-9 leak flag_health_mention was built to avoid.
-- Fix: agent_record_objection now takes a fixed CATEGORY, not free text, and
-- stores a canonical label from a closed set. No model-authored prose ever
-- lands in the field, so there is nothing sensitive to leak and nothing an
-- injected message can smuggle onto a staff screen. The verbatim wording
-- still lives only in the transcript (agent_messages), which the
-- conversation-retention sweep covers.
--
-- Also: skip terminal leads (a converted member or lost lead must not be
-- re-flagged for chase); scope the write to the conversation's gym; exclude
-- opted-out prospects (a STOPped, closed conversation) from the stale sweep;
-- and give staff a way to clear a follow-up without changing the pipeline
-- stage. set_lead_status now also clears the concern once a lead converts.

begin;

create or replace function public.agent_record_objection(
  p_conversation_id uuid,
  p_category        text,
  p_intent          text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym    uuid;
  v_lead   uuid;
  v_status public.lead_status;
  v_coach  uuid;
  v_intent text := lower(coalesce(p_intent, 'considering'));
  v_label  text := case lower(btrim(coalesce(p_category, '')))
    when 'price'     then 'Price / cost'
    when 'time'      then 'Timing / schedule'
    when 'location'  then 'Location / distance'
    when 'nerves'    then 'Nervous / unsure'
    when 'comparing' then 'Comparing gyms'
    when 'not_ready' then 'Not ready yet'
    else 'Other'
  end;
begin
  select c.gym_id, c.lead_id, l.status
    into v_gym, v_lead, v_status
    from public.agent_conversations c
    join public.leads l on l.id = c.lead_id
    where c.id = p_conversation_id;
  if v_lead is null then
    return;
  end if;
  -- A member who already joined, or a lead a human marked lost, is not a
  -- chase candidate — record nothing.
  if v_status in ('converted'::public.lead_status, 'lost'::public.lead_status) then
    return;
  end if;
  if v_intent not in ('considering', 'deferred', 'declined') then
    v_intent := 'considering';
  end if;

  update public.leads
    set objection = v_label,
        follow_up_at = case v_intent
          when 'deferred' then now() + interval '3 days'
          when 'declined' then now()
          else follow_up_at
        end
    where id = v_lead and gym_id = v_gym;

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

create or replace function public.flag_stale_leads()
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
          -- A prospect who replied STOP (closed conversation) has opted out —
          -- never resurface them as a lead to chase.
          and not exists (
            select 1 from public.agent_conversations c
            where c.lead_id = l.id and c.status = 'closed'
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

create function public.clear_lead_follow_up(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.leads where id = p_lead_id;
  if v_gym is null then
    raise exception 'Lead not found';
  end if;
  if not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.leads set follow_up_at = null where id = p_lead_id;
end;
$$;
grant execute on function public.clear_lead_follow_up(uuid) to authenticated;

-- set_lead_status already clears follow_up_at (0150); also clear the concern
-- once the lead converts, since it's resolved. Same body otherwise.
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
          follow_up_at         = null,
          objection            = null
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
