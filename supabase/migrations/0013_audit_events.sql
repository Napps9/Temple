-- Phase 1 / Track A: cross-cutting audit log.
--
-- docs/entitlement-states.md promises audit_events rows for every
-- state transition (e.g. "Audit: row created with audit_events.kind
-- = 'plan_sub_pending'"). This migration lands the table that
-- promise refers to.
--
-- Every state-mutating RPC and webhook handler in Tracks B, C, D, F,
-- G writes a row here. Members read events about themselves; staff
-- read everything in their gym; writes are service-role only (RPCs
-- and webhooks bypass RLS via SECURITY DEFINER).
--
-- subject_kind / subject_id is a polymorphic pointer to the entity
-- the event is about. Examples by track:
--   B: subject_kind='plan_subscription'  → plan_subscriptions.id
--      subject_kind='discount'           → discounts.discount_id
--   C: subject_kind='message'            → messages.message_id
--   E: subject_kind='workout_log'        → workout_logs.log_id
-- No FK is enforced (the subject table can vary), but indexes on
-- (gym_id, subject_kind, subject_id) make per-entity history fast.

create table public.audit_events (
  event_id          uuid primary key default gen_random_uuid(),
  gym_id            uuid references public.gyms(id) on delete set null,
  actor_profile_id  uuid references public.profiles(id),
  subject_kind      text not null,
  subject_id        uuid,
  kind              text not null,
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now()
);

-- actor_profile_id NULL means "system / webhook handler" (no human
-- actor). subject_id NULL means "the gym itself" (e.g. Connect
-- onboarding events whose subject is the gym).

create index audit_events_gym_subject_idx
  on public.audit_events(gym_id, subject_kind, subject_id);
create index audit_events_actor_idx
  on public.audit_events(actor_profile_id) where actor_profile_id is not null;
create index audit_events_occurred_at_idx
  on public.audit_events(occurred_at);
create index audit_events_kind_idx
  on public.audit_events(kind);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.audit_events enable row level security;

-- Members see events about themselves (subject is the member's profile)
-- or where they're the actor (their own actions in their account).
create policy audit_events_self_select on public.audit_events
  for select using (
    (subject_kind = 'member' and subject_id = auth.uid())
    or actor_profile_id = auth.uid()
  );

-- Staff (Owner/Coach/Staff via user_can_assign_plan) read everything
-- in their gym. Platform-only events (gym_id IS NULL) are hidden
-- from staff — they belong to Track F.
create policy audit_events_staff_select on public.audit_events
  for select using (
    gym_id is not null and public.user_can_assign_plan(gym_id)
  );

-- No insert/update/delete policies: writes are service-role only.
