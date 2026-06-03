-- Phase 1 / Track G: SOP documents (§6.5).
--
-- Operational documents the coaching team writes for themselves:
-- "how we run intros", "fire-alarm process", "what to do when a
-- coach is sick". Markdown body, free-text category for ad-hoc
-- grouping, archive instead of delete so links from elsewhere
-- don't 404.
--
-- Staff-only — never visible to members. Reuses
-- user_can_assign_plan since the team that admins the gym is the
-- team that writes the SOPs.

create table public.sop_documents (
  sop_id         uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  title          text not null,
  category       text,
  body_markdown  text not null default '',
  updated_by     uuid not null references public.profiles(id),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index sop_documents_gym_idx
  on public.sop_documents(gym_id, category, title)
  where archived_at is null;

alter table public.sop_documents enable row level security;

create policy sop_documents_staff_select on public.sop_documents
  for select using (public.user_can_assign_plan(gym_id));

create policy sop_documents_staff_write on public.sop_documents
  for all using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));
