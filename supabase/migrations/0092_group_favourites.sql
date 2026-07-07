-- Movement Library, phase 2: star whole groups, not just movements.
--
-- A member can now favourite at two levels — an individual movement
-- (tracked_movement_favourites, 0091) or a whole group. A group star
-- stars every movement in the group; the Track home then renders it as a
-- single group tile, while individually-starred movements render as their
-- own tiles. Deselecting movements inside a starred group shrinks it; the
-- home collapses a group to a single movement tile once only one remains
-- (that count logic lives in the client — this table just records which
-- groups the member chose to treat as a group).
--
-- Same shape and rationale as tracked_movement_favourites: personal,
-- profile-portable (no gym_id), self-only RLS. group_key references the
-- static catalog in src/lib/movements.ts; stored as text so the catalog
-- can evolve without a schema change.

begin;

create table public.tracked_group_favourites (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  group_key   text not null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, group_key)
);

alter table public.tracked_group_favourites enable row level security;

create policy tracked_group_favourites_self_select
  on public.tracked_group_favourites
  for select using (profile_id = auth.uid());

create policy tracked_group_favourites_self_insert
  on public.tracked_group_favourites
  for insert with check (profile_id = auth.uid());

create policy tracked_group_favourites_self_delete
  on public.tracked_group_favourites
  for delete using (profile_id = auth.uid());

commit;
