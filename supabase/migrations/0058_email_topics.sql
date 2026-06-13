-- Phase 4a — tiered email preferences.
--
-- Until now `email_unsubscribes` was blanket: one row per
-- (gym_id, lower(email)) meant "do not send anything". For gyms
-- running multiple kinds of communication (newsletter, programming
-- updates, billing, refer-a-friend promos) this is too coarse: a
-- member who hits "unsubscribe" on a promo blocks themselves out of
-- billing reminders too.
--
-- Phase 4a adds:
--
--   - gym_email_topics — per-gym vocabulary, owner-defined. Each
--     topic carries a label, an optional description for the
--     preference UI, and a sort_order. archived_at retires a topic
--     without breaking historical campaigns that referenced it.
--
--   - email_unsubscribes.topic_id (nullable)
--     NULL row = blanket (the existing semantics, suppress every
--     campaign for that email). A non-null row only suppresses
--     campaigns sent under that topic.
--
--   - email_campaigns.topic_id (nullable)
--     The category the campaign is being sent under. NULL preserves
--     the pre-0058 behaviour (treated as "default / general" — only
--     blanket suppressions apply).
--
-- comms_audience_rows + comms_audience_count grow a p_topic_id arg
-- and combine the blanket + per-topic suppression in one filter.

begin;

-- ============================================================================
-- 1. gym_email_topics
-- ============================================================================

create table public.gym_email_topics (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  label        text not null,
  description  text,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index gym_email_topics_gym_idx
  on public.gym_email_topics(gym_id, sort_order, created_at);

create unique index gym_email_topics_gym_label_unique
  on public.gym_email_topics(gym_id, lower(label))
  where archived_at is null;

alter table public.gym_email_topics enable row level security;

-- Topics are visible to anyone in the gym (members read them in the
-- preferences UI). Only comms-managing staff can write.
create policy gym_email_topics_tenant_select on public.gym_email_topics
  for select using (public.user_belongs_to(gym_id));
create policy gym_email_topics_comms_write on public.gym_email_topics
  for all using (public.effective_can(gym_id, 'can_manage_comms'))
  with check (public.effective_can(gym_id, 'can_manage_comms'));

create or replace function public._gym_email_topics_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger gym_email_topics_touch_updated_at_trg
  before update on public.gym_email_topics
  for each row execute function public._gym_email_topics_touch_updated_at();

-- ============================================================================
-- 2. email_unsubscribes.topic_id + reworked unique indexes
-- ============================================================================

alter table public.email_unsubscribes
  add column if not exists topic_id uuid references public.gym_email_topics(id)
    on delete cascade;

-- The original index forbade two rows per (gym, email). Now we want
-- exactly one blanket row OR a set of per-topic rows. Two partial
-- indexes preserve that without depending on NULLS NOT DISTINCT.

drop index if exists email_unsubscribes_unique;

create unique index email_unsubscribes_blanket_unique
  on public.email_unsubscribes (gym_id, lower(email))
  where topic_id is null;

create unique index email_unsubscribes_per_topic_unique
  on public.email_unsubscribes (gym_id, lower(email), topic_id)
  where topic_id is not null;

-- ============================================================================
-- 3. email_campaigns.topic_id (nullable)
-- ============================================================================

alter table public.email_campaigns
  add column if not exists topic_id uuid references public.gym_email_topics(id)
    on delete set null;

create index email_campaigns_gym_topic_idx
  on public.email_campaigns(gym_id, topic_id)
  where topic_id is not null;

-- ============================================================================
-- 4. Audience resolver: filter by topic
-- ============================================================================
--
-- The existing one-arg form keeps the old "blanket only" semantics by
-- delegating with topic_id => null; new callers pass the campaign's
-- topic_id explicitly.

create or replace function public.comms_audience_rows(
  p_gym_id     uuid,
  p_definition jsonb,
  p_topic_id   uuid
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language sql
security definer
stable
set search_path = public
as $$
  with selected as (
    select b.profile_id
    from public.gym_memberships b
    where b.gym_id = p_gym_id
      and b.left_at is null
      and case coalesce(p_definition->>'kind', 'cohorts')
        when 'cohorts' then exists (
          select 1 from public.v_member_cohort c
          where c.gym_id = p_gym_id and c.profile_id = b.profile_id
            and (
              ((p_definition->'cohorts') ? 'intro'         and c.is_intro)         or
              ((p_definition->'cohorts') ? 'active'        and c.is_active)        or
              ((p_definition->'cohorts') ? 'paying'        and c.is_paying)        or
              ((p_definition->'cohorts') ? 'expiring_soon' and c.is_expiring_soon) or
              ((p_definition->'cohorts') ? 'expired'       and c.is_expired)
            )
        )
        when 'tags' then exists (
          select 1 from public.member_tags mt
          where mt.gym_id = p_gym_id and mt.profile_id = b.profile_id
            and (p_definition->'tags') ? mt.label
        )
        when 'manual' then (p_definition->'profile_ids') ? b.profile_id::text
        else false
      end
  )
  select distinct on (lower(u.email))
    s.profile_id,
    p.full_name,
    u.email
  from selected s
  join public.profiles p on p.id = s.profile_id
  join auth.users u on u.id = s.profile_id
  where u.email is not null
    and length(trim(u.email)) > 0
    and not exists (
      -- Blanket suppressions always win.
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id
        and lower(eu.email) = lower(u.email)
        and eu.topic_id is null
    )
    and not exists (
      -- Per-topic suppression only if the campaign was sent under a
      -- topic; legacy NULL-topic campaigns skip this check.
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id
        and lower(eu.email) = lower(u.email)
        and eu.topic_id = p_topic_id
        and p_topic_id is not null
    )
  order by lower(u.email);
$$;

revoke all on function public.comms_audience_rows(uuid, jsonb, uuid) from public;

create or replace function public.comms_audience_count(
  p_gym_id     uuid,
  p_definition jsonb,
  p_topic_id   uuid
) returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from public.comms_audience_rows(p_gym_id, p_definition, p_topic_id);
$$;

grant execute on function public.comms_audience_count(uuid, jsonb, uuid) to authenticated;
grant execute on function public.comms_audience_rows(uuid, jsonb, uuid) to authenticated;

-- ============================================================================
-- 5. Backwards-compatible two-arg shims
-- ============================================================================
--
-- The existing campaign editor calls the two-arg form. Keep it
-- working by delegating to the three-arg with topic_id = null
-- (which preserves the legacy "blanket only" suppression). The
-- builder will start passing the campaign's topic_id once the UI
-- ships the picker.

create or replace function public.comms_audience_rows(
  p_gym_id     uuid,
  p_definition jsonb
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language sql
security definer
stable
set search_path = public
as $$
  select * from public.comms_audience_rows(p_gym_id, p_definition, null::uuid);
$$;

create or replace function public.comms_audience_count(
  p_gym_id     uuid,
  p_definition jsonb
) returns integer
language sql
security definer
stable
set search_path = public
as $$
  select public.comms_audience_count(p_gym_id, p_definition, null::uuid);
$$;

grant execute on function public.comms_audience_count(uuid, jsonb) to authenticated;
grant execute on function public.comms_audience_rows(uuid, jsonb) to authenticated;

commit;
