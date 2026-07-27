-- Make the health-data audit log tell the truth.
--
-- 0037 built the audit trail and the roadmap has carried the caveat ever
-- since: the log is written by the app surfaces, not enforced at the row
-- level, so a staff member with can_see_health_flag who calls PostgREST
-- directly reads injuries and leaves no trace. The DPIA and the
-- lawful-basis register both lean on that log.
--
-- Worse than the theoretical case, there are three staff read paths for
-- member_injuries and only ONE of them logs today:
--
--   management/members/[profile].tsx  — logs (0037's only caller)
--   management/analysis.tsx           — gym-wide injury heat map, silent
--   components/MembersList.tsx        — injury flags on the roster, silent
--
-- So the gap is not hypothetical: the surface that reads EVERY member's
-- injuries at once is the one that never wrote an audit row.
--
-- Fix: the staff branch comes off the table policies, and staff read
-- through definer RPCs that log as a side effect. A member reading their
-- own injuries is untouched and unlogged — self-access is not third-party
-- access and logging it would bury the rows that matter.

begin;

-- ============================================================================
-- 1. Staff read paths, each logging as it goes
-- ============================================================================

create or replace function public.gym_member_injuries(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  id             uuid,
  body_region    text,
  side           text,
  description    text,
  pain_level     integer,
  movements_hurt text[],
  movements_ok   text[],
  started_on     date,
  status         text,
  updated_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Not `stable`: this writes the audit row, which is the point.
  perform public.log_health_data_access(p_gym_id, p_profile_id, 'member_profile');

  return query
  select mi.id, mi.body_region, mi.side::text, mi.description, mi.pain_level,
         mi.movements_hurt, mi.movements_ok, mi.started_on, mi.status::text,
         mi.updated_at
  from public.member_injuries mi
  where mi.gym_id = p_gym_id
    and mi.profile_id = p_profile_id
  order by mi.updated_at desc;
end;
$$;

grant execute on function public.gym_member_injuries(uuid, uuid) to authenticated;

create or replace function public.gym_injury_updates(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  injury_id  uuid,
  pain_level integer,
  feeling    text,
  status     text,
  note       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_health_data_access(p_gym_id, p_profile_id, 'member_profile');

  return query
  select iu.injury_id, iu.pain_level, iu.feeling::text, iu.status::text,
         iu.note, iu.created_at
  from public.injury_updates iu
  where iu.gym_id = p_gym_id
    and iu.profile_id = p_profile_id
  order by iu.created_at desc;
end;
$$;

grant execute on function public.gym_injury_updates(uuid, uuid) to authenticated;

-- The gym-wide read. One audit row per view rather than per member: the
-- log records that someone opened the whole board, which is the honest
-- description of what happened, and a row per member would drown the
-- single-member views that matter more.
create or replace function public.gym_open_injuries(
  p_gym_id  uuid,
  p_surface text default 'gym_overview'
) returns table (
  id             uuid,
  profile_id     uuid,
  full_name      text,
  body_region    text,
  side           text,
  pain_level     integer,
  status         text,
  movements_hurt text[],
  updated_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  insert into public.health_data_access_log
    (gym_id, actor_id, subject_profile_id, action, surface)
    values (p_gym_id, auth.uid(), null, 'view',
            coalesce(nullif(p_surface, ''), 'gym_overview'));

  return query
  select mi.id, mi.profile_id, p.full_name, mi.body_region, mi.side::text,
         mi.pain_level, mi.status::text, mi.movements_hurt, mi.updated_at
  from public.member_injuries mi
  join public.profiles p on p.id = mi.profile_id
  where mi.gym_id = p_gym_id
    and mi.status <> 'resolved'
  order by mi.updated_at desc;
end;
$$;

grant execute on function public.gym_open_injuries(uuid, text) to authenticated;

-- ============================================================================
-- 2. Close the unlogged door
-- ============================================================================
--
-- subject_profile_id is nullable for the gym-wide row above; it was not,
-- because until now every logged read named one member.

alter table public.health_data_access_log
  alter column subject_profile_id drop not null;

drop policy member_injuries_self_or_staff_select on public.member_injuries;
create policy member_injuries_self_select on public.member_injuries
  for select using (profile_id = auth.uid());

drop policy injury_updates_self_or_staff_select on public.injury_updates;
create policy injury_updates_self_select on public.injury_updates
  for select using (profile_id = auth.uid());

commit;
