-- Programming per class type per day.
--
-- One row per (class_type_id, date). Sections (title + body) live in a
-- jsonb array — keeps the v1 model simple: a single upsert per save,
-- no section-id tracking, reorder is just an array rearrangement.
--
-- Reads: anyone in the gym can see the day's programming.
-- Writes: owners + coaches only, via the existing
-- user_can_manage_classes helper.

create table public.class_programming (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  class_type_id   uuid not null references public.class_types(id) on delete cascade,
  date            date not null,
  sections        jsonb not null default '[]'::jsonb,
  author_id       uuid not null references public.profiles(id),
  updated_at      timestamptz not null default now(),
  unique (class_type_id, date)
);

create index class_programming_gym_date_idx
  on public.class_programming (gym_id, date);

alter table public.class_programming enable row level security;

create policy class_programming_tenant_select on public.class_programming
  for select using (public.user_belongs_to(gym_id));

create policy class_programming_coach_write on public.class_programming
  for all
  using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));
