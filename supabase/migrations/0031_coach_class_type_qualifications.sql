-- Per-coach class-type qualifications.
--
-- A coach is qualified to teach a class type by default. A row in this
-- table with qualified=false marks an explicit disqualification (e.g.
-- a coach not certified for CrossFit Kids). Rows with qualified=true
-- are only meaningful as overrides if/when we move to an opt-in
-- default — today they're treated as a no-op vs the default.
--
-- The presence-based approach was tempting (no rows = qualified, row
-- present = not qualified) but the explicit boolean keeps the door
-- open for a future "explicit allow / explicit deny / unset" UX
-- without a destructive schema change.
--
-- RLS mirrors coach_pay_rates: self-select for the coach reading their
-- own quals, full read/write for staff with can_set_coach_pay.
--
-- The (gym_id, profile_id) composite FK back to gym_memberships keeps
-- quals from dangling when a coach is removed from the gym — same
-- pattern as 0027.

begin;

create table if not exists public.coach_class_type_qualifications (
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  class_type_id   uuid not null references public.class_types(id) on delete cascade,
  qualified       boolean not null default true,
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  primary key (gym_id, profile_id, class_type_id),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index if not exists coach_class_type_qualifications_lookup_idx
  on public.coach_class_type_qualifications (profile_id, class_type_id);

alter table public.coach_class_type_qualifications enable row level security;

create policy coach_quals_self_or_pay_select on public.coach_class_type_qualifications
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_set_coach_pay')
  );

create policy coach_quals_pay_insert on public.coach_class_type_qualifications
  for insert with check (public.effective_can(gym_id, 'can_set_coach_pay'));

create policy coach_quals_pay_update on public.coach_class_type_qualifications
  for update
  using (public.effective_can(gym_id, 'can_set_coach_pay'))
  with check (public.effective_can(gym_id, 'can_set_coach_pay'));

create policy coach_quals_pay_delete on public.coach_class_type_qualifications
  for delete using (public.effective_can(gym_id, 'can_set_coach_pay'));

commit;
