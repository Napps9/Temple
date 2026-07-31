-- The lead pipeline gets its own switch
--
-- Everything in the front desk — the board, the enquiry form, assignment,
-- follow-ups, the AI conversations and their settings — has been gated on
-- can_assign_plan. That key is described to owners on the Team screen as
-- "Assign plans: put members onto plans and adjust subscriptions", which
-- is not what working a sales pipeline is. An owner who wanted a coach on
-- the phones had to hand them membership billing to do it, and an owner
-- who wanted somebody off membership billing lost the phones.
--
-- The owner's call was to split it, defaulting to exactly who holds it
-- today: admin, coach and front desk, with owner true by short-circuit.
-- Nothing changes on day one — the same people can do the same things —
-- and from day two the two switches can move apart, which is the whole
-- point.
--
-- Two things move at once, because leaving either behind is worse than
-- doing both:
--
--   * The five RPCs 0217 moved onto effective_can move onto the new key.
--   * The nine policies across seven tables move too, AND off the raw
--     role helper. They still read user_can_assign_plan, which is
--     role in ('owner','admin','coach','staff') with no left_at guard and
--     no override lookup — so a coach whose "Assign plans" switch an
--     owner turned off could still read the whole pipeline, and somebody
--     who left in March could read it in July. Same bug class as 0217's,
--     one layer down.
--
-- What does NOT move: plan_subscriptions, comp_grants and
-- membership_change_requests. Those are membership machinery and
-- can_assign_plan is the right key for them — it is the only key it
-- should ever have been.

-- ---------------------------------------------------------------------------
-- 1. The new key
-- ---------------------------------------------------------------------------
--
-- 0169's function, restated with one line added.

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    -- Same people can_assign_plan has today, so the split changes
    -- nothing on day one and the switch finally says what it does.
    when 'can_work_leads'        then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_manage_website'         then p_role = 'admin'
    when 'can_program_members'        then p_role in ('admin','coach')
    when 'can_review_ai_calls'        then p_role = 'admin'
    when 'can_bulk_edit_classes'      then p_role = 'admin'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The five lead RPCs
-- ---------------------------------------------------------------------------
--
-- 0217's functions, restated with one gate line each. Everything else is
-- exactly as it was.

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
  if not public.effective_can(p_gym_id, 'can_work_leads') then
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
  if not public.effective_can(v_gym, 'can_work_leads') then
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
  if not public.effective_can(v_gym, 'can_work_leads') then
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
  if not public.effective_can(v_gym, 'can_work_leads') then
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
  if not public.effective_can(v_gym_id, 'can_work_leads') then
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

-- ---------------------------------------------------------------------------
-- 3. The pipeline's own tables
-- ---------------------------------------------------------------------------
--
-- A policy's USING clause cannot be altered in place, so each is dropped
-- and recreated with the same name, the same command and the same shape.
-- The predicate is the only thing that changes.

drop policy if exists leads_tenant_select on public.leads;
create policy leads_tenant_select on public.leads
  for select using (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists leads_staff_insert on public.leads;
create policy leads_staff_insert on public.leads
  for insert with check (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists leads_staff_update on public.leads;
create policy leads_staff_update on public.leads
  for update using (public.effective_can(gym_id, 'can_work_leads'))
  with check (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists lead_sources_staff_write on public.lead_sources;
create policy lead_sources_staff_write on public.lead_sources
  for all using (public.effective_can(gym_id, 'can_work_leads'))
  with check (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists lead_assignment_rules_tenant_select
  on public.lead_assignment_rules;
create policy lead_assignment_rules_tenant_select
  on public.lead_assignment_rules
  for select using (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists lead_notifications_tenant_select
  on public.lead_notifications;
create policy lead_notifications_tenant_select on public.lead_notifications
  for select using (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists agent_conversations_tenant_select
  on public.agent_conversations;
create policy agent_conversations_tenant_select on public.agent_conversations
  for select using (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists agent_messages_tenant_select on public.agent_messages;
create policy agent_messages_tenant_select on public.agent_messages
  for select using (public.effective_can(gym_id, 'can_work_leads'));

drop policy if exists gym_agent_settings_tenant_select
  on public.gym_agent_settings;
create policy gym_agent_settings_tenant_select on public.gym_agent_settings
  for select using (public.effective_can(gym_id, 'can_work_leads'));
