-- Phase QA pass — tighten cross-tenant validation on lead writes.
--
-- record_lead accepted any source_id (FK-valid but not necessarily
-- belonging to the target gym), and set_lead_status accepted any
-- profile as the converted member (FK to profiles, not gym-scoped). In
-- practice the UI only ever passes same-gym values, but a hand-crafted
-- call from an authorised staff member could attach another gym's
-- source label or attribute a conversion to a non-member. Validate
-- both belong to the gym — defence in depth for the multi-tenant
-- boundary.

begin;

create or replace function public.record_lead(
  p_gym_id    uuid,
  p_full_name text,
  p_email     text default null,
  p_phone     text default null,
  p_source_id uuid default null,
  p_notes     text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_source_id is not null and not exists (
    select 1 from public.lead_sources
    where id = p_source_id and gym_id = p_gym_id
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
  return v_id;
end;
$$;
grant execute on function public.record_lead(uuid, text, text, text, uuid, text)
  to authenticated;

create or replace function public.set_lead_status(
  p_lead_id              uuid,
  p_status               public.lead_status,
  p_converted_profile_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
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
          converted_profile_id = p_converted_profile_id
      where id = p_lead_id;
  else
    update public.leads
      set status               = p_status,
          converted_at         = null,
          converted_profile_id = null
      where id = p_lead_id;
  end if;
end;
$$;
grant execute on function public.set_lead_status(uuid, public.lead_status, uuid)
  to authenticated;

commit;
