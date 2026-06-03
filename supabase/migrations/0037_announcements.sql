-- Phase 1 / Track D: announcements (§4.3).
--
-- Coach or owner publishes a notice; members at the gym see it.
-- audience_id is optional — null = everyone in the gym; non-null
-- means it goes only to members matching the audience predicate
-- (sprint 4 lands the table; sprint 5 wires audience filtering
-- through the read query once the audience engine has a SQL mirror).
--
-- announcement_reads tracks per-member read state so the UI can
-- badge unread items and clear the badge when the member taps in.
-- pinned + expires_at let owners pin a notice to the top until
-- some date.

create table public.announcements (
  announcement_id uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  audience_id     uuid references public.audience_definitions(audience_id) on delete set null,
  title           text not null,
  body            text not null,
  pinned          boolean not null default false,
  published_at    timestamptz not null default now(),
  expires_at      timestamptz,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);

create index announcements_gym_published_idx
  on public.announcements(gym_id, published_at desc);

alter table public.announcements enable row level security;

-- Members at the gym read announcements; expired ones still
-- visible for historical context (UI filters if it wants to).
create policy announcements_tenant_select on public.announcements
  for select using (public.user_belongs_to(gym_id));

-- Coaches and owners publish; staff role can publish too via
-- user_can_manage_classes (broad enough for coaching-team
-- announcements, narrow enough to keep members out).
create policy announcements_coach_write on public.announcements
  for all using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));

-- ============================================================================
-- announcement_reads
-- ============================================================================

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(announcement_id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

create index announcement_reads_profile_idx on public.announcement_reads(profile_id);

alter table public.announcement_reads enable row level security;

create policy announcement_reads_self on public.announcement_reads
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Staff can read everyone's read state for engagement metrics.
create policy announcement_reads_staff_select on public.announcement_reads
  for select using (
    exists (
      select 1 from public.announcements a
      where a.announcement_id = announcement_reads.announcement_id
        and public.user_can_assign_plan(a.gym_id)
    )
  );
