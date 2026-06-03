-- Phase 1 / Track C: comms backbone (audiences, tags, templates, outbox).
--
-- Schema only. The dispatcher edge function and React Query hooks
-- land in a later sprint 2/3 slice. This migration is the foundation
-- the webhook's invoice.payment_failed branch and the receipt
-- trigger (0025) write into.
--
-- Audience predicates are stored as jsonb (a simple AND-of-clauses
-- DSL: field/op/value). The TS audience-engine evaluator is sprint
-- 3 work; this migration just lets operators author and persist
-- audiences and gives the dispatcher a queue to drain.
--
-- The messages table is RLS-aware: members read their own; staff
-- read everything in their gym. The dispatcher writes via service
-- role.

-- ============================================================================
-- 1. Enums
-- ============================================================================

create type public.message_channel as enum (
  'email',
  'announcement',
  'sms',
  'chat'
);

create type public.message_state as enum (
  'queued',
  'sending',
  'sent',
  'failed',
  'bounced'
);

-- ============================================================================
-- 2. tags + member_tags
--    Owners author tags; coaches/staff apply them; the audience
--    engine and per-member screens read them.
-- ============================================================================

create table public.tags (
  tag_id      uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  unique (gym_id, lower(name))
);

create index tags_gym_idx on public.tags(gym_id);

alter table public.tags enable row level security;

create policy tags_tenant_select on public.tags
  for select using (public.user_belongs_to(gym_id));
create policy tags_owner_manage on public.tags
  for all using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));

create table public.member_tags (
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null,
  tag_id     uuid not null references public.tags(tag_id) on delete cascade,
  added_by   uuid not null references public.profiles(id),
  added_at   timestamptz not null default now(),
  primary key (gym_id, profile_id, tag_id),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index member_tags_profile_idx on public.member_tags(gym_id, profile_id);
create index member_tags_tag_idx     on public.member_tags(tag_id);

alter table public.member_tags enable row level security;

create policy member_tags_self_select on public.member_tags
  for select using (profile_id = auth.uid());
create policy member_tags_staff_select on public.member_tags
  for select using (public.user_can_assign_plan(gym_id));
create policy member_tags_staff_manage on public.member_tags
  for all using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- 3. audience_definitions
--    JSON predicate DSL. Sprint 3 lands the evaluator
--    (src/lib/audience-engine.ts).
-- ============================================================================

create table public.audience_definitions (
  audience_id      uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  name             text not null,
  predicate        jsonb not null default '{"clauses": []}'::jsonb,
  last_evaluated_at timestamptz,
  created_at       timestamptz not null default now()
);

create index audience_definitions_gym_idx on public.audience_definitions(gym_id);

alter table public.audience_definitions enable row level security;

create policy audience_definitions_staff_select on public.audience_definitions
  for select using (public.user_can_assign_plan(gym_id));
create policy audience_definitions_owner_manage on public.audience_definitions
  for all using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 4. message_templates
--    NULL gym_id = global system template (seeded). Per-gym
--    templates override the global of the same system_kind at
--    dispatch time.
-- ============================================================================

create table public.message_templates (
  template_id  uuid primary key default gen_random_uuid(),
  gym_id       uuid references public.gyms(id) on delete cascade,
  channel      public.message_channel not null,
  system_kind  text,
  name         text not null,
  subject      text,
  body         text not null,
  created_at   timestamptz not null default now(),
  -- A gym may have at most one template per (channel, system_kind);
  -- the same constraint applies to global templates (gym_id NULL).
  unique (gym_id, channel, system_kind)
);

create index message_templates_kind_idx
  on public.message_templates(channel, system_kind);

alter table public.message_templates enable row level security;

-- Global templates readable by everyone authenticated; gym templates
-- by tenant; only owners manage gym templates.
create policy message_templates_global_select on public.message_templates
  for select using (gym_id is null and auth.role() = 'authenticated');
create policy message_templates_tenant_select on public.message_templates
  for select using (gym_id is not null and public.user_belongs_to(gym_id));
create policy message_templates_owner_manage on public.message_templates
  for all using (gym_id is not null and public.user_is_owner_of(gym_id))
  with check (gym_id is not null and public.user_is_owner_of(gym_id));

-- ============================================================================
-- 5. messages outbox
--    Both queue and audit log. Dispatcher polls state='queued'.
--    Webhook handlers (dunning, receipts, etc.) insert directly with
--    state='queued'.
-- ============================================================================

create table public.messages (
  message_id          uuid primary key default gen_random_uuid(),
  gym_id              uuid references public.gyms(id) on delete set null,
  channel             public.message_channel not null,
  template_id         uuid references public.message_templates(template_id) on delete set null,
  system_kind         text,
  audience_id         uuid references public.audience_definitions(audience_id) on delete set null,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  subject             text,
  rendered_body       text,
  context             jsonb not null default '{}'::jsonb,
  state               public.message_state not null default 'queued',
  provider_message_id text,
  error               text,
  attempts            integer not null default 0,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create index messages_state_idx        on public.messages(state) where state in ('queued', 'sending');
create index messages_recipient_idx    on public.messages(recipient_profile_id, created_at desc);
create index messages_gym_created_idx  on public.messages(gym_id, created_at desc);

alter table public.messages enable row level security;

create policy messages_self_select on public.messages
  for select using (recipient_profile_id = auth.uid());
create policy messages_staff_select on public.messages
  for select using (
    gym_id is not null and public.user_can_assign_plan(gym_id)
  );

-- No insert/update/delete policies: writes are service-role only
-- (webhook handlers and the dispatcher).

-- ============================================================================
-- 6. Seed system templates (channel = email).
--    Per-gym overrides can replace the body / subject at dispatch
--    time by matching (gym_id, channel, system_kind).
-- ============================================================================

insert into public.message_templates (channel, system_kind, name, subject, body) values
  ('email', 'payment_failed', 'Payment failed (system)',
    'Your payment did not go through',
    E'Hi {{member_name}},\n\nWe couldn''t process your latest payment for {{gym_name}}.\nPlease update your card to keep your membership active:\n{{update_card_url}}\n\nThanks,\n{{gym_name}}\n'),
  ('email', 'payment_action_required', 'Authentication required (system)',
    'Confirm your payment',
    E'Hi {{member_name}},\n\nYour bank needs you to confirm the latest payment for {{gym_name}}:\n{{confirm_url}}\n\nThanks,\n{{gym_name}}\n'),
  ('email', 'invoice_paid_receipt', 'Receipt (system)',
    'Receipt for {{gym_name}}',
    E'Hi {{member_name}},\n\nThanks — we received {{amount_display}} on {{paid_at_display}}.\nView the full receipt: {{receipt_url}}\n\n{{gym_name}}\n'),
  ('email', 'refund_processed', 'Refund processed (system)',
    'Refund of {{amount_display}}',
    E'Hi {{member_name}},\n\nWe refunded {{amount_display}} to your card on {{refunded_at_display}}.\n\n{{gym_name}}\n');
