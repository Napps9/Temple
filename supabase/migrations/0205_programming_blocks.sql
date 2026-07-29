-- 0205: The programming roadmap (docs/roadmap.md phase 5).
--
-- The workflow the interviews asked for twice: a year of named training
-- blocks ("Squat strength — 8 weeks", "Open prep"), set by the owner or
-- head coach and visible to the whole coaching team, so a coach writing
-- Tuesday always knows where in the plan they are. It lives inside the
-- programming calendar — a strip above the week being written, and a
-- zoomed-out Year view — not a new surface.
--
-- Reads and writes both sit behind user_can_manage_classes, the same
-- helper that gates writing programming itself: the roadmap is coaching
-- material, not member content.

create table public.programming_blocks (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 60),
  starts_on  date not null,
  ends_on    date not null,
  color      text not null default '#3B82F6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  note       text check (note is null or char_length(note) <= 200),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint programming_blocks_window_ck check (ends_on >= starts_on)
);

create index programming_blocks_gym_start_idx
  on public.programming_blocks(gym_id, starts_on);

alter table public.programming_blocks enable row level security;

create policy programming_blocks_coach_select on public.programming_blocks
  for select using (public.user_can_manage_classes(gym_id));

create policy programming_blocks_coach_write on public.programming_blocks
  for all
  using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));
