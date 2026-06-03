-- Phase 2 Tier 5: SQL helpers + tables for admin, insights, reporting.
--
-- Helpers map 1:1 onto a column of the capability matrix in
-- src/lib/can.ts so the SQL gate cannot drift from the JS gate.
-- Every new RLS policy and every new RPC gates on exactly one helper.
--
-- Tables added:
--   member_tags             — manual + auto tags
--   tag_rules               — owner/admin-defined auto-tag rules
--   coach_tasks             — day-to-day staff work
--   cover_requests          — cover request header
--   cover_request_sessions  — per-session claim units
--   sop_documents           — team "how we do X" documents
--   gym_insight_targets     — owner-set monthly/quarterly goals
--
-- Attendance state is bolted onto class_bookings (not a separate
-- table) — bookings already model (member × session) with the right
-- unique constraint and RLS.
--
-- All composite FKs that compose with gym_memberships use the
-- (gym_id, profile_id) pair (already unique on gym_memberships from
-- 0001) so cross-gym attachment is a constraint violation at the DB
-- layer.

-- ============================================================================
-- 1. New helpers (SECURITY DEFINER, stable)
-- ============================================================================

create or replace function public.user_can_admin(target_gym_id uuid)
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
      and role in ('owner', 'admin')
  );
$$;
grant execute on function public.user_can_admin(uuid) to authenticated;

create or replace function public.user_can_admin_or_coach(target_gym_id uuid)
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
      and role in ('owner', 'admin', 'coach')
  );
$$;
grant execute on function public.user_can_admin_or_coach(uuid) to authenticated;

create or replace function public.user_can_access_staff_area(target_gym_id uuid)
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
      and role in ('owner', 'admin', 'coach', 'staff')
  );
$$;
grant execute on function public.user_can_access_staff_area(uuid) to authenticated;

create or replace function public.user_can_cover(target_gym_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- Owner + coach only. Admin excluded by design: admins don't coach.
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and role in ('owner', 'coach')
  );
$$;
grant execute on function public.user_can_cover(uuid) to authenticated;

-- Replace existing helpers to include the new 'admin' role where the
-- capability matrix grants it.

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
      and role in ('owner', 'admin', 'coach')
  );
$$;

create or replace function public.user_can_assign_plan(target_gym_id uuid)
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
      and role in ('owner', 'admin', 'coach', 'staff')
  );
$$;

-- ============================================================================
-- 2. gym_memberships: admin SELECT + UPDATE
--    (owner policies from 0002 stay; admin needs to see/manage the
--    full member list to populate insights/tags screens and to manage
--    staff roles.)
-- ============================================================================

create policy gym_memberships_admin_select on public.gym_memberships
  for select using (public.user_can_admin(gym_id));

create policy gym_memberships_admin_update on public.gym_memberships
  for update using (public.user_can_admin(gym_id))
  with check (public.user_can_admin(gym_id));

-- ============================================================================
-- 3. class_bookings: attendance state + member-delete guard
-- ============================================================================

alter table public.class_bookings
  add column attended_at        timestamptz,
  add column marked_by          uuid references public.profiles(id),
  add column no_show            boolean not null default false,
  add column no_show_marked_at  timestamptz,
  add constraint class_bookings_attendance_xor
    check (
      (attended_at is null and no_show = false and no_show_marked_at is null)
      or (attended_at is not null and no_show = false)
      or (attended_at is null and no_show = true and no_show_marked_at is not null)
    ),
  add constraint class_bookings_marked_by_required
    check (
      (attended_at is null and no_show = false)
      or marked_by is not null
    );

create index class_bookings_attendance_idx
  on public.class_bookings(gym_id, attended_at)
  where attended_at is not null;

-- Replace the existing DELETE policy so members cannot erase a
-- no-show or attended booking from their own record (otherwise
-- attendance stats lie).
drop policy if exists class_bookings_self_or_staff_delete on public.class_bookings;

create policy class_bookings_self_or_staff_delete on public.class_bookings
  for delete using (
    (profile_id = auth.uid()
      and attended_at is null
      and no_show = false)
    or public.user_can_admin_or_coach(gym_id)
  );

-- ============================================================================
-- 4. tag_rules: owner/admin-defined auto-tag rules
-- ============================================================================

create table public.tag_rules (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  label           text not null,
  color           text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  predicate_kind  text not null check (predicate_kind in (
    'intro', 'expiring_soon', 'expired', 'paying', 'inactive', 'never_paid'
  )),
  threshold_days  integer check (threshold_days is null or threshold_days >= 0),
  active          boolean not null default true,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (gym_id, label)
);

create index tag_rules_gym_active_idx on public.tag_rules(gym_id, active);

alter table public.tag_rules enable row level security;

create policy tag_rules_tenant_select on public.tag_rules
  for select using (public.user_belongs_to(gym_id));
create policy tag_rules_admin_insert on public.tag_rules
  for insert with check (public.user_can_admin(gym_id));
create policy tag_rules_admin_update on public.tag_rules
  for update using (public.user_can_admin(gym_id))
  with check (public.user_can_admin(gym_id));
create policy tag_rules_admin_delete on public.tag_rules
  for delete using (public.user_can_admin(gym_id));

-- ============================================================================
-- 5. member_tags: manual + auto tags on a member
-- ============================================================================

create table public.member_tags (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  label       text not null,
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  source      text not null check (source in ('manual', 'auto')),
  rule_id     uuid references public.tag_rules(id) on delete cascade,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (gym_id, profile_id, label),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade,
  check ((source = 'auto') = (rule_id is not null))
);

create index member_tags_gym_profile_idx on public.member_tags(gym_id, profile_id);
create index member_tags_gym_label_idx   on public.member_tags(gym_id, label);
create index member_tags_rule_idx        on public.member_tags(rule_id)
  where rule_id is not null;

alter table public.member_tags enable row level security;

create policy member_tags_tenant_select on public.member_tags
  for select using (public.user_belongs_to(gym_id));
create policy member_tags_admin_insert on public.member_tags
  for insert with check (public.user_can_admin(gym_id));
create policy member_tags_admin_update on public.member_tags
  for update using (public.user_can_admin(gym_id))
  with check (public.user_can_admin(gym_id));
create policy member_tags_admin_delete on public.member_tags
  for delete using (public.user_can_admin(gym_id));

-- ============================================================================
-- 6. coach_tasks: day-to-day staff work
-- ============================================================================

create table public.coach_tasks (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  assigned_to     uuid not null references public.profiles(id),
  created_by      uuid not null references public.profiles(id),
  target_profile  uuid references public.profiles(id) on delete set null,
  title           text not null check (char_length(title) > 0),
  notes           text,
  status          text not null default 'open'
                    check (status in ('open', 'done', 'cancelled')),
  due_date        date,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (gym_id, assigned_to)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index coach_tasks_gym_status_due_idx
  on public.coach_tasks(gym_id, status, due_date);
create index coach_tasks_assigned_status_idx
  on public.coach_tasks(assigned_to, status);

alter table public.coach_tasks enable row level security;

-- SELECT: admin/owner/coach see all gym tasks; assignees see their own.
create policy coach_tasks_admin_or_assignee_select on public.coach_tasks
  for select using (
    public.user_can_admin_or_coach(gym_id)
    or assigned_to = auth.uid()
  );

-- CUD: admin/owner/coach only. Toggling status for assignees flows
-- through complete_task / reopen_task RPCs (0014). RLS WITH CHECK
-- only sees the new row, so an assignee-self UPDATE policy can't
-- enforce "only the status column changed" — RPCs give column-level
-- guarantees.
create policy coach_tasks_admin_insert on public.coach_tasks
  for insert with check (public.user_can_admin_or_coach(gym_id));
create policy coach_tasks_admin_update on public.coach_tasks
  for update using (public.user_can_admin_or_coach(gym_id))
  with check (public.user_can_admin_or_coach(gym_id));
create policy coach_tasks_admin_delete on public.coach_tasks
  for delete using (public.user_can_admin_or_coach(gym_id));

-- ============================================================================
-- 7. cover_requests + cover_request_sessions
-- ============================================================================

create table public.cover_requests (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  requested_by  uuid not null references public.profiles(id),
  range_start   timestamptz not null,
  range_end     timestamptz not null,
  notes         text,
  status        text not null default 'open'
                  check (status in ('open', 'partial', 'claimed', 'cancelled', 'expired')),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  check (range_end > range_start)
);

create index cover_requests_gym_status_idx
  on public.cover_requests(gym_id, status, range_start);

alter table public.cover_requests enable row level security;

-- SELECT: owner + coach only (the people who could claim or request).
create policy cover_requests_cover_select on public.cover_requests
  for select using (public.user_can_cover(gym_id));

-- All writes go through RPCs in 0014.

create table public.cover_request_sessions (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.cover_requests(id) on delete cascade,
  class_session_id   uuid not null references public.class_sessions(id) on delete cascade,
  original_coach_id  uuid not null references public.profiles(id),
  claimed_by         uuid references public.profiles(id),
  claimed_at         timestamptz,
  gym_id             uuid not null references public.gyms(id) on delete cascade
);

create unique index cover_request_sessions_open_session_uniq
  on public.cover_request_sessions(class_session_id)
  where claimed_by is null;

create index cover_request_sessions_request_idx
  on public.cover_request_sessions(request_id);
create index cover_request_sessions_open_idx
  on public.cover_request_sessions(gym_id, claimed_by)
  where claimed_by is null;

alter table public.cover_request_sessions enable row level security;

create policy cover_request_sessions_cover_select on public.cover_request_sessions
  for select using (public.user_can_cover(gym_id));

-- Keep cover_request_sessions.gym_id in sync with its parent request.
create or replace function public.cover_request_sessions_sync_gym()
returns trigger
language plpgsql
as $$
declare
  v_parent_gym uuid;
begin
  select gym_id into v_parent_gym
    from public.cover_requests
    where id = new.request_id;
  if v_parent_gym is null then
    raise exception 'cover_request_sessions.request_id % does not resolve to a cover_requests row',
      new.request_id;
  end if;
  new.gym_id := v_parent_gym;
  return new;
end;
$$;

create trigger cover_request_sessions_sync_gym_trg
  before insert or update of request_id
  on public.cover_request_sessions
  for each row execute function public.cover_request_sessions_sync_gym();

-- ============================================================================
-- 8. sop_documents
-- ============================================================================

create table public.sop_documents (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  title          text not null check (char_length(title) > 0),
  body_markdown  text not null default '',
  category       text,
  author_id      uuid not null references public.profiles(id),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create index sop_documents_gym_archived_idx
  on public.sop_documents(gym_id, archived_at);

alter table public.sop_documents enable row level security;

-- SELECT: everyone in the staff area (owner/admin/coach/staff need to read SOPs).
create policy sop_documents_staff_select on public.sop_documents
  for select using (public.user_can_access_staff_area(gym_id));
-- CUD: owner + admin only.
create policy sop_documents_admin_insert on public.sop_documents
  for insert with check (public.user_can_admin(gym_id));
create policy sop_documents_admin_update on public.sop_documents
  for update using (public.user_can_admin(gym_id))
  with check (public.user_can_admin(gym_id));
create policy sop_documents_admin_delete on public.sop_documents
  for delete using (public.user_can_admin(gym_id));

-- ============================================================================
-- 9. gym_insight_targets
-- ============================================================================

create table public.gym_insight_targets (
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  metric        text not null check (metric in ('intros_new', 'conversions', 'retention')),
  period        text not null check (period in ('month', 'quarter')),
  target_value  integer not null check (target_value >= 0),
  updated_by    uuid not null references public.profiles(id),
  updated_at    timestamptz not null default now(),
  primary key (gym_id, metric, period)
);

alter table public.gym_insight_targets enable row level security;

-- SELECT: owner + admin (mirrors can_see_insights).
create policy gym_insight_targets_admin_select on public.gym_insight_targets
  for select using (public.user_can_admin(gym_id));
-- CUD: owner only (mirrors can_set_targets).
create policy gym_insight_targets_owner_insert on public.gym_insight_targets
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_insight_targets_owner_update on public.gym_insight_targets
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_insight_targets_owner_delete on public.gym_insight_targets
  for delete using (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 10. Index on class_sessions for cover-overlap / coach-schedule queries
-- ============================================================================

create index if not exists class_sessions_coach_starts_idx
  on public.class_sessions(coach_id, starts_at)
  where coach_id is not null;
