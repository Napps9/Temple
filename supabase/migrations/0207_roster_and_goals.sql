-- 0207: The Roster's rope dial and Goals (docs/roadmap.md phase 9).
--
-- Two small pieces:
--
-- 1. set_agent_job_level — the Roster's rope dial. "Always allow" in the
--    Timeline flips authority one way as a side-effect of an approval
--    (0206); the Roster needs the deliberate version, both directions,
--    owner-only.
--
-- 2. gym_goals — "200 members by December" as a brief, not a KPI tile.
--    The old gym_insight_targets (0013) can't say it: its metric enum is
--    intros/conversions/retention with no member count, and it's had no
--    screen since the Targets editor was dropped. Goals start with the
--    one metric every interview led with — members — auto-read from the
--    roster, so the weekly note is computed, never typed.

create or replace function public.set_agent_job_level(
  p_gym_id      uuid,
  p_action_kind text,
  p_level       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only the owner can change this';
  end if;
  if p_level not in ('autonomous', 'approval', 'reserved') then
    raise exception 'Unknown level';
  end if;

  update public.agent_authority
    set level = p_level, updated_by = auth.uid(), updated_at = now()
    where gym_id = p_gym_id and action_kind = p_action_kind;
  if not found then
    raise exception 'That job is not switched on';
  end if;
end;
$$;

revoke all on function public.set_agent_job_level(uuid, text, text)
  from public, anon;
grant execute on function public.set_agent_job_level(uuid, text, text)
  to authenticated;

create table public.gym_goals (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  kind         text not null default 'members' check (kind in ('members')),
  target_value integer not null check (target_value > 0),
  due_on       date not null,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  achieved_at  timestamptz
);

create index gym_goals_gym_idx on public.gym_goals(gym_id, due_on);

alter table public.gym_goals enable row level security;

-- Same audience as the old targets: owner + admin read, owner writes.
create policy gym_goals_admin_select on public.gym_goals
  for select using (public.user_can_admin(gym_id));
create policy gym_goals_owner_insert on public.gym_goals
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_goals_owner_update on public.gym_goals
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_goals_owner_delete on public.gym_goals
  for delete using (public.user_is_owner_of(gym_id));
