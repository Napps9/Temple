-- Operating hours per day-of-week and class sessions scheduled within them.
--
-- gym_hours: a row per day-of-week per gym. Absence of a row means "closed
-- all day". opens_at/closes_at use the database's local time (we treat the
-- gym as living in one timezone for now).
--
-- class_sessions: a specific scheduled class. starts_at is a timestamptz;
-- duration_minutes is the length. Coaches and owners can manage these.

create table public.gym_hours (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  day_of_week int  not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  opens_at    time not null,
  closes_at   time not null,
  created_at  timestamptz not null default now(),
  unique (gym_id, day_of_week),
  check (opens_at < closes_at)
);

create table public.class_sessions (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  name             text not null,
  coach_id         uuid references public.profiles(id),
  starts_at        timestamptz not null,
  duration_minutes int  not null default 60 check (duration_minutes > 0),
  capacity         int  not null default 12 check (capacity > 0),
  notes            text,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now()
);

create index class_sessions_gym_starts_idx on public.class_sessions(gym_id, starts_at);

alter table public.gym_hours     enable row level security;
alter table public.class_sessions enable row level security;

create or replace function public.user_can_manage_classes(target_gym_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and role in ('owner', 'coach')
      and status = 'active'
  );
$$;
grant execute on function public.user_can_manage_classes(uuid) to authenticated;

create policy gym_hours_tenant_select on public.gym_hours
  for select using (public.user_belongs_to(gym_id));

create policy class_sessions_tenant_select on public.class_sessions
  for select using (public.user_belongs_to(gym_id));

create policy gym_hours_owner_insert on public.gym_hours
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_hours_owner_update on public.gym_hours
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_hours_owner_delete on public.gym_hours
  for delete using (public.user_is_owner_of(gym_id));

create policy class_sessions_coach_insert on public.class_sessions
  for insert with check (public.user_can_manage_classes(gym_id));
create policy class_sessions_coach_update on public.class_sessions
  for update using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));
create policy class_sessions_coach_delete on public.class_sessions
  for delete using (public.user_can_manage_classes(gym_id));
