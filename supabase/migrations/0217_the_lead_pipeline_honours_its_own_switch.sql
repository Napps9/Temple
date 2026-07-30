-- The lead pipeline honours the switch the Team screen shows
--
-- Fourth of these, and the last one on this capability. The leads screen
-- gates itself on useCan('can_assign_plan'); every RPC behind it gates on
-- user_can_assign_plan, which is a raw role test — owner, admin, coach or
-- staff — and not the capability at all.
--
-- For a gym that has overridden nothing the two agree exactly: the
-- capability's defaults are the same four roles. The differences are the
-- two that matter.
--
--  1. An owner's override does nothing. Turn "Assign plans" off for
--     coaches in Team and the leads board disappears from their screen
--     while every write behind it still succeeds — through PostgREST, or
--     simply by the screen being wrong about itself. A permission switch
--     that hides a button is not a permission switch.
--
--  2. user_can_assign_plan has no left_at guard (0013:112). Someone who
--     has left the gym keeps write access to the lead pipeline, which is
--     names, emails and phone numbers of people who never joined.
--     effective_can requires left_at is null, so this closes with the
--     same edit.
--
-- Same five functions, restated with one line changed each, because
-- CREATE OR REPLACE needs the whole body and the bodies are otherwise
-- exactly what 0114, 0150 and 0151 wrote.
--
-- What this does NOT fix: `can_assign_plan` is the wrong capability to be
-- gating a sales pipeline on. It is described to owners as "Put members
-- onto plans and adjust subscriptions", and the leads board has nothing
-- to do with plans. Splitting it out is a new capability key, a default
-- per role, and a row on the Team screen — a change owners would see, so
-- it is written up in docs/roadmap.md rather than smuggled in here.

create or replace function public.record_lead(
  p_gym_id    uuid,
  p_full_name text,
  p_email     text default null,
  p_phone     text default null,
  p_source_id uuid default null,
  p_notes     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  -- Cross-tenant guard on source (0067 pattern).
  if p_source_id is not null and not exists (
    select 1 from public.lead_sources where id = p_source_id and gym_id = p_gym_id
  ) then
    raise exception 'Lead source does not belong to this gym';
  end if;

  insert into public.leads
    (gym_id, full_name, email, phone, source_id, notes, captured_by)
  values
    (p_gym_id, btrim(p_full_name),
     nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_phone, '')), ''),
     p_source_id, p_notes, v_uid)
  returning id into v_id;

  perform public.assign_lead(v_id);
  return v_id;
end;
$$;

create or replace function public.set_lead_assignee(
  p_lead_id  uuid,
  p_coach_id uuid
) returns void
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
  if not public.effective_can(v_gym, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  -- Cross-tenant guard: the coach must belong to this gym.
  if p_coach_id is not null and not exists (
    select 1 from public.gym_memberships
    where gym_id = v_gym and profile_id = p_coach_id and left_at is null
  ) then
    raise exception 'Coach is not a member of this gym';
  end if;

  update public.leads
    set assigned_coach_id = p_coach_id,
        assigned_at = case when p_coach_id is null then null else now() end
    where id = p_lead_id;

  if p_coach_id is not null then
    perform public.enqueue_lead_notifications(p_lead_id, p_coach_id, 'assigned');
  end if;
end;
$$;

create or replace function public.nudge_lead(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym   uuid;
  v_coach uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id, assigned_coach_id into v_gym, v_coach
    from public.leads where id = p_lead_id;
  if v_gym is null then
    raise exception 'Lead not found';
  end if;
  if not public.effective_can(v_gym, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  if v_coach is null then
    raise exception 'Lead has no assignee to nudge';
  end if;
  -- A date-stamped reason makes each day's nudge a distinct send while
  -- still coalescing accidental double-taps within the same day.
  perform public.enqueue_lead_notifications(
    p_lead_id, v_coach, 'nudge:' || to_char(now(), 'YYYY-MM-DD'));
end;
$$;

create or replace function public.clear_lead_follow_up(p_lead_id uuid)
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
  if not public.effective_can(v_gym, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  update public.leads set follow_up_at = null where id = p_lead_id;
end;
$$;

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
  if not public.effective_can(v_gym_id, 'can_assign_plan') then
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
