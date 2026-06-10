-- Injury tracker + plan notice periods.
--
-- Members log injuries against a body region (picked on the body map),
-- with pain level, affected movements, and a start date. Weekly
-- check-ins append injury_updates rows; the parent row carries the
-- latest pain/status so lists never need to aggregate.
--
-- Staff visibility rides the existing health-data capability
-- (can_see_health_flag) — injuries are health data exactly like PAR-Q
-- responses, and the staff surfaces (members list badge, member
-- profile, programming analysis) overlap. New injuries and updates
-- also raise staff_alerts (kinds injury_new / injury_update) through
-- the same alert table PAR-Q uses, so coaches hear about them in the
-- inbox without a new pipeline.
--
-- Write path is RPC-only (log_injury / log_injury_update) so the
-- alert insert can't be skipped; staff_alerts has no member INSERT
-- policy. Direct UPDATE on member_injuries stays open for the owner
-- (self) so a member can edit a description/movement list without
-- minting a check-in row.
--
-- membership_plans.notice_period_days: surfaced on the member profile
-- ("as per membership") next to payment dates. Nullable — gyms that
-- don't enforce notice simply leave it unset.

begin;

-- ============================================================================
-- 1. membership_plans.notice_period_days
-- ============================================================================

alter table public.membership_plans
  add column if not exists notice_period_days integer
    check (notice_period_days is null or notice_period_days >= 0);

-- ============================================================================
-- 2. member_injuries
-- ============================================================================

create table if not exists public.member_injuries (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  body_region    text not null,
  side           text not null default 'na'
    check (side in ('left', 'right', 'both', 'na')),
  description    text,
  pain_level     integer not null check (pain_level between 0 and 10),
  movements_hurt text[] not null default '{}',
  movements_ok   text[] not null default '{}',
  started_on     date not null default current_date,
  status         text not null default 'active'
    check (status in ('active', 'improving', 'resolved')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  -- An injury can't outlive the membership it was logged under.
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index member_injuries_gym_open_idx
  on public.member_injuries (gym_id, created_at desc)
  where status <> 'resolved';

create index member_injuries_member_idx
  on public.member_injuries (gym_id, profile_id, created_at desc);

-- ============================================================================
-- 3. injury_updates (weekly check-ins / progress notes)
-- ============================================================================

create table if not exists public.injury_updates (
  id          uuid primary key default gen_random_uuid(),
  injury_id   uuid not null
    references public.member_injuries(id) on delete cascade,
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  pain_level  integer not null check (pain_level between 0 and 10),
  feeling     text check (feeling in ('better', 'same', 'worse')),
  status      text not null
    check (status in ('active', 'improving', 'resolved')),
  note        text,
  created_at  timestamptz not null default now()
);

create index injury_updates_injury_idx
  on public.injury_updates (injury_id, created_at desc);

-- ============================================================================
-- 4. staff_alerts: new kinds
-- ============================================================================

alter table public.staff_alerts
  drop constraint staff_alerts_kind_check;
alter table public.staff_alerts
  add constraint staff_alerts_kind_check
  check (kind in ('parq_flag', 'injury_new', 'injury_update'));

-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table public.member_injuries enable row level security;
alter table public.injury_updates enable row level security;

create policy member_injuries_self_or_staff_select on public.member_injuries
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_health_flag')
  );

create policy member_injuries_self_insert on public.member_injuries
  for insert with check (profile_id = auth.uid());

create policy member_injuries_self_update on public.member_injuries
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy injury_updates_self_or_staff_select on public.injury_updates
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_health_flag')
  );

create policy injury_updates_self_insert on public.injury_updates
  for insert with check (profile_id = auth.uid());

-- ============================================================================
-- 6. RPCs — single write path so staff alerts always fire
-- ============================================================================

create or replace function public.log_injury(
  p_gym_id         uuid,
  p_body_region    text,
  p_side           text,
  p_description    text,
  p_pain_level     integer,
  p_movements_hurt text[],
  p_movements_ok   text[],
  p_started_on     date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_injury_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_caller
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  insert into public.member_injuries
    (gym_id, profile_id, body_region, side, description, pain_level,
     movements_hurt, movements_ok, started_on)
    values
    (p_gym_id, v_caller, p_body_region, coalesce(p_side, 'na'),
     nullif(p_description, ''), p_pain_level,
     coalesce(p_movements_hurt, '{}'), coalesce(p_movements_ok, '{}'),
     coalesce(p_started_on, current_date))
    returning id into v_injury_id;

  insert into public.staff_alerts
    (gym_id, kind, subject_profile_id, related_id)
    values (p_gym_id, 'injury_new', v_caller, v_injury_id);

  return v_injury_id;
end;
$$;

grant execute on function
  public.log_injury(uuid, text, text, text, integer, text[], text[], date)
  to authenticated;

create or replace function public.log_injury_update(
  p_injury_id  uuid,
  p_pain_level integer,
  p_feeling    text,
  p_status     text,
  p_note       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_injury    public.member_injuries%rowtype;
  v_update_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_injury
    from public.member_injuries
    where id = p_injury_id;
  if v_injury.id is null then
    raise exception 'Injury not found';
  end if;
  if v_injury.profile_id <> v_caller then
    raise exception 'Not your injury';
  end if;

  insert into public.injury_updates
    (injury_id, gym_id, profile_id, pain_level, feeling, status, note)
    values
    (p_injury_id, v_injury.gym_id, v_caller, p_pain_level,
     nullif(p_feeling, ''), p_status, nullif(p_note, ''))
    returning id into v_update_id;

  update public.member_injuries
    set pain_level  = p_pain_level,
        status      = p_status,
        updated_at  = now(),
        resolved_at = case when p_status = 'resolved' then now() end
    where id = p_injury_id;

  insert into public.staff_alerts
    (gym_id, kind, subject_profile_id, related_id)
    values (v_injury.gym_id, 'injury_update', v_caller, p_injury_id);

  return v_update_id;
end;
$$;

grant execute on function
  public.log_injury_update(uuid, integer, text, text, text)
  to authenticated;

commit;
