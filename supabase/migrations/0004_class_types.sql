-- Class types: per-gym, owner+coach managed, used to colour and label
-- class_sessions on the calendar.

create table public.class_types (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  name        text not null,
  color       text not null,                   -- '#RRGGBB'
  created_at  timestamptz not null default now(),
  unique (gym_id, name)
);

create index class_types_gym_id_idx on public.class_types(gym_id);

alter table public.class_sessions
  add column class_type_id uuid references public.class_types(id) on delete set null;

create index class_sessions_class_type_id_idx on public.class_sessions(class_type_id);

alter table public.class_types enable row level security;

create policy class_types_tenant_select on public.class_types
  for select using (public.user_belongs_to(gym_id));

create policy class_types_coach_insert on public.class_types
  for insert with check (public.user_can_manage_classes(gym_id));

create policy class_types_coach_update on public.class_types
  for update using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));

create policy class_types_coach_delete on public.class_types
  for delete using (public.user_can_manage_classes(gym_id));
