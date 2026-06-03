-- Phase 1 / Track E: programming blueprints + coach notes (§5.3).
--
-- Coaches build programming once and reuse it. A blueprint is a
-- saved snapshot of a class_programming.sections payload — a day or
-- a week — that can be applied to future dates. Snapshot semantics:
-- once captured, the blueprint is independent of the source row.
-- Editing programming on April 1 doesn't drag the blueprint copy
-- along.
--
-- Coach notes are per-programming notes scoped to coach view: not
-- visible to members. The body text is intent, prep tips, scaling
-- reminders — the working notes a coaching team shares with each
-- other.

-- ============================================================================
-- 1. programming_blueprints — reusable day or week templates
-- ============================================================================

create type public.blueprint_kind as enum ('day', 'week');

create table public.programming_blueprints (
  blueprint_id   uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  name           text not null,
  kind           public.blueprint_kind not null,
  class_type_id  uuid references public.class_types(id) on delete set null,
  -- For day blueprints: { sections: [...] }
  -- For week blueprints: { days: [{ day_offset: 0, sections: [...] }, ...] }
  body           jsonb not null default '{}'::jsonb,
  created_by     uuid not null references public.profiles(id),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index programming_blueprints_gym_idx on public.programming_blueprints(gym_id);

alter table public.programming_blueprints enable row level security;

create policy programming_blueprints_tenant_select on public.programming_blueprints
  for select using (public.user_belongs_to(gym_id));

create policy programming_blueprints_coach_write on public.programming_blueprints
  for all using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));

-- ============================================================================
-- 2. snapshot_blueprint_from_day
--    Captures the current class_programming row for (class_type_id,
--    date) as a day blueprint.
-- ============================================================================

create or replace function public.snapshot_blueprint_from_day(
  p_class_type_id uuid,
  p_date          date,
  p_name          text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id     uuid;
  v_sections   jsonb;
  v_blueprint  uuid;
  v_actor      uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select gym_id, sections into v_gym_id, v_sections
  from public.class_programming
  where class_type_id = p_class_type_id and date = p_date;
  if v_gym_id is null then
    raise exception 'No programming for that class type and date';
  end if;

  if not public.user_can_manage_classes(v_gym_id) then
    raise exception 'Not authorised to create blueprints at this gym';
  end if;

  insert into public.programming_blueprints (
    gym_id, name, kind, class_type_id, body, created_by
  ) values (
    v_gym_id,
    p_name,
    'day',
    p_class_type_id,
    jsonb_build_object('sections', v_sections),
    v_actor
  )
  returning blueprint_id into v_blueprint;

  return v_blueprint;
end;
$$;

grant execute on function public.snapshot_blueprint_from_day(uuid, date, text) to authenticated;

-- ============================================================================
-- 3. apply_day_blueprint
--    Copies a day blueprint's sections into the class_programming
--    row for the target (class_type_id, date). Upserts — overwrites
--    any existing programming for that day.
-- ============================================================================

create or replace function public.apply_day_blueprint(
  p_blueprint_id   uuid,
  p_class_type_id  uuid,
  p_target_date    date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_bp       public.programming_blueprints;
  v_gym_id   uuid;
  v_sections jsonb;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_bp
  from public.programming_blueprints
  where blueprint_id = p_blueprint_id;
  if v_bp.blueprint_id is null then
    raise exception 'Blueprint not found';
  end if;
  if v_bp.kind <> 'day' then
    raise exception 'apply_day_blueprint expects a day blueprint';
  end if;

  if not public.user_can_manage_classes(v_bp.gym_id) then
    raise exception 'Not authorised to apply blueprints at this gym';
  end if;

  select gym_id into v_gym_id
  from public.class_types where id = p_class_type_id;
  if v_gym_id <> v_bp.gym_id then
    raise exception 'Class type belongs to a different gym';
  end if;

  v_sections := v_bp.body -> 'sections';

  insert into public.class_programming (
    gym_id, class_type_id, date, sections, author_id, updated_at
  ) values (
    v_bp.gym_id, p_class_type_id, p_target_date, v_sections, v_actor, now()
  )
  on conflict (class_type_id, date) do update
    set sections   = excluded.sections,
        author_id  = excluded.author_id,
        updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.apply_day_blueprint(uuid, uuid, date) to authenticated;

-- ============================================================================
-- 4. class_programming_coach_notes — per-programming, coach-only
-- ============================================================================

create table public.class_programming_coach_notes (
  programming_id uuid primary key references public.class_programming(id) on delete cascade,
  body           text not null,
  updated_by     uuid not null references public.profiles(id),
  updated_at     timestamptz not null default now()
);

alter table public.class_programming_coach_notes enable row level security;

-- Coaches and owners only — never members. Mirrors
-- user_can_manage_classes scope.
create policy coach_notes_coach_select on public.class_programming_coach_notes
  for select using (
    exists (
      select 1 from public.class_programming cp
      where cp.id = class_programming_coach_notes.programming_id
        and public.user_can_manage_classes(cp.gym_id)
    )
  );

create policy coach_notes_coach_write on public.class_programming_coach_notes
  for all using (
    exists (
      select 1 from public.class_programming cp
      where cp.id = class_programming_coach_notes.programming_id
        and public.user_can_manage_classes(cp.gym_id)
    )
  )
  with check (
    exists (
      select 1 from public.class_programming cp
      where cp.id = class_programming_coach_notes.programming_id
        and public.user_can_manage_classes(cp.gym_id)
    )
  );
