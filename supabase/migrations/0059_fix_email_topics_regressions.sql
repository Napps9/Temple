-- 0058 broke two things the pre-existing pgTAP suite caught:
--
-- 1. comms_audience_rows lost the original 'all_members' kind (the
--    default email_campaigns.audience kind, which every existing
--    campaign uses) and the role = 'member' base filter. The result
--    was zero recipients for any campaign that hadn't been opted into
--    a cohort, tags, or manual audience explicitly. Every legacy
--    campaign would have thrown "audience has no members" on send.
--
-- 2. apply_pending_member_data (0047) inserts into email_unsubscribes
--    with `on conflict (gym_id, lower(email))`. 0058 dropped that
--    exact unique index in favour of two partial ones; ON CONFLICT
--    without a predicate can no longer find an arbiter. The
--    pending-member sign-up path threw the moment a pending row with
--    unsubscribed = true matched a fresh signup.
--
-- This migration restores the original kind dispatch (extended with
-- the topic suppression) and rewrites the apply_pending_member_data
-- insert to point at the blanket partial index.

begin;

-- ============================================================================
-- 1. comms_audience_rows — restore the original behaviour + add topic check
-- ============================================================================

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
  with base as (
    select gm.profile_id
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.left_at is null
      and gm.role = 'member'
  ),
  selected as (
    select b.profile_id
    from base b
    where case coalesce(p_definition->>'kind', 'all_members')
      when 'all_members' then true
      when 'cohort' then exists (
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
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id
        and lower(eu.email) = lower(u.email)
        and eu.topic_id is null
    )
    and not exists (
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id
        and lower(eu.email) = lower(u.email)
        and eu.topic_id = p_topic_id
        and p_topic_id is not null
    )
  order by lower(u.email);
$$;

-- ============================================================================
-- 2. apply_pending_member_data — point on-conflict at the blanket index
-- ============================================================================

create or replace function public.apply_pending_member_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending public.pending_members%rowtype;
begin
  select pm.* into v_pending
    from public.pending_members pm
    join auth.users u on lower(u.email) = lower(pm.email)
    where pm.gym_id = new.gym_id
      and u.id = new.profile_id
      and pm.status = 'pending'
    limit 1;
  if v_pending.id is null then
    return new;
  end if;

  update public.gym_memberships
    set imported_plan_name        = coalesce(v_pending.plan_name,         imported_plan_name),
        imported_plan_end         = coalesce(v_pending.plan_end,          imported_plan_end),
        imported_credits_remaining = coalesce(v_pending.credits_remaining, imported_credits_remaining)
    where id = new.id;

  -- Tags carry across as manual neutral-grey labels attributed to the
  -- new member. The unique index is on (gym_id, profile_id,
  -- lower(label)); not exists keeps the upsert idempotent across
  -- repeated triggers.
  if v_pending.tags is not null and array_length(v_pending.tags, 1) > 0 then
    insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    select new.gym_id, new.profile_id, t, '#6B7280', 'manual', new.profile_id
    from unnest(v_pending.tags) t
    where not exists (
      select 1 from public.member_tags mt
      where mt.gym_id = new.gym_id
        and mt.profile_id = new.profile_id
        and lower(mt.label) = lower(t)
    );
  end if;

  if v_pending.unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, reason)
      values (v_pending.gym_id, v_pending.email, new.profile_id, 'imported')
      on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  end if;

  update public.pending_members
    set status = 'linked',
        linked_at = now(),
        linked_profile_id = new.profile_id
    where id = v_pending.id;

  return new;
end;
$$;

commit;
