-- Which lift a member means by an ambiguous word in programming.
--
-- Programming bodies are free text, and the percentage resolver
-- (src/lib/percent-prescription.ts) has to work out which lift
-- "5x1 clean @ 80%" is a percentage of. The movement detector
-- (src/lib/movement-detection.ts) deliberately refuses bare family
-- words — "clean", "squat", "press" name a family, not a lift — so
-- those are exactly the cases where we ask the member instead of
-- guessing a number they might load onto a bar.
--
-- One answer settles it for good: "when programming says clean, I mean
-- Power Clean". Keyed on the term rather than the section, so the
-- answer carries across every future workout that uses the same word.
--
-- A table rather than device storage because a member reads programming
-- on their phone and on the web, and re-asking on each device would be
-- worse than not asking at all.
--
-- Shape follows tracked_movement_favourites (0091) exactly: no gym_id,
-- self-only RLS. This is a personal preference and travels with the
-- profile across gyms. movement_key references the static catalog in
-- src/lib/movements.ts, stored as text so the catalog can evolve
-- without a schema change.

begin;

create table public.member_movement_preferences (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  -- Lower-cased and whitespace-collapsed by the client before writing,
  -- so "Clean" and "clean " are the same answer.
  term         text not null check (term = lower(btrim(term)) and length(term) > 0),
  movement_key text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (profile_id, term)
);

alter table public.member_movement_preferences enable row level security;

create policy member_movement_preferences_self_select
  on public.member_movement_preferences
  for select using (profile_id = auth.uid());

create policy member_movement_preferences_self_insert
  on public.member_movement_preferences
  for insert with check (profile_id = auth.uid());

-- Unlike favourites, this one is genuinely updatable: a member who
-- picked the wrong variant changes their mind from the same picker,
-- which upserts on the primary key.
create policy member_movement_preferences_self_update
  on public.member_movement_preferences
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy member_movement_preferences_self_delete
  on public.member_movement_preferences
  for delete using (profile_id = auth.uid());

commit;
