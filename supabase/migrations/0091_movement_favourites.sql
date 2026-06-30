-- Movement Library: per-member "starred" movements.
--
-- The Track Movement Library lets a member search/browse the full
-- cross-discipline catalog (not just their gym's discipline) and star
-- the movements they care about so they have a fast path back to them.
--
-- Favourites are a personal preference, not gym data: like the rest of a
-- member's tracking history they travel with the profile across gyms, so
-- this table has no gym_id and RLS is a plain self-only gate on
-- profile_id (matching the membership-independent self-select branch the
-- other tracked_* tables use).
--
-- movement_key references the static catalog in src/lib/movements.ts
-- (CrossFit + Hyrox); stored as text so the catalog can evolve without a
-- schema change, same as tracked_movement_results / _section_movement_tags.

begin;

create table public.tracked_movement_favourites (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  movement_key text not null,
  created_at   timestamptz not null default now(),
  primary key (profile_id, movement_key)
);

alter table public.tracked_movement_favourites enable row level security;

create policy tracked_movement_favourites_self_select
  on public.tracked_movement_favourites
  for select using (profile_id = auth.uid());

create policy tracked_movement_favourites_self_insert
  on public.tracked_movement_favourites
  for insert with check (profile_id = auth.uid());

create policy tracked_movement_favourites_self_delete
  on public.tracked_movement_favourites
  for delete using (profile_id = auth.uid());

commit;
