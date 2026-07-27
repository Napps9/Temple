-- Two live bugs in the comms suite, both regressions from a redefinition
-- that dropped something the previous version had.
--
-- 1. THE DOUBLE-SEND LOCK WENT MISSING. 0045 added `for update` to
--    comms_send_campaign specifically to serialise two concurrent Send
--    clicks: the second transaction blocks, then sees status 'sending'
--    and bails on the status check. 0062 re-declared the function to pass
--    the topic through and copied the 0044 body, which predates the lock.
--    The recipient unique index still stops duplicate ROWS, so nobody has
--    been double-emailed by this — but both callers can pass the status
--    check, both can flip the campaign to 'sending', and the count
--    returned to the second one is whatever the first had just written.
--
-- 2. THE pending_members AUDIENCE SENDS TO NOBODY. 0046 implemented it in
--    the two-arg comms_audience_rows. 0058 replaced that with a shim
--    delegating to a new three-arg version, and the three-arg body never
--    had the branch. The client still offers "Imported members" as an
--    audience (src/lib/email/audience.ts), so a gym can build a campaign
--    for exactly the people it most wants to reach — members it has
--    imported but who have not signed up yet — hit send, and reach none of
--    them. It fails as an empty audience, which reads as "nobody matched"
--    rather than as a fault.
--
-- Pending members are not in gym_memberships and have no auth.users row,
-- so they cannot come out of the `base` CTE; the branch is a separate
-- union, as it was in 0046. profile_id is null for them, which is why
-- email_campaign_recipients.profile_id is nullable.

begin;

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
  ),
  member_rows as (
    select distinct on (lower(u.email))
      s.profile_id,
      p.full_name,
      u.email::text as email
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
    order by lower(u.email)
  ),
  -- Restored from 0046. Imported-but-not-signed-up members live in
  -- pending_members with no profile and no auth.users row, so they cannot
  -- come through `base` — this is a separate union, as it was before.
  pending_rows as (
    select distinct on (lower(pm.email))
      null::uuid as profile_id,
      pm.full_name,
      pm.email::text as email
    from public.pending_members pm
    where coalesce(p_definition->>'kind', '') = 'pending_members'
      and pm.gym_id = p_gym_id
      and pm.status in ('pending', 'invited')
      and pm.email is not null
      and length(trim(pm.email)) > 0
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(pm.email)
          and eu.topic_id is null
      )
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id
          and lower(eu.email) = lower(pm.email)
          and eu.topic_id = p_topic_id
          and p_topic_id is not null
      )
    order by lower(pm.email)
  )
  select * from member_rows
  union all
  select * from pending_rows;
$$;

-- Body is 0062's verbatim apart from the restored lock.
create or replace function public.comms_send_campaign(
  p_campaign_id uuid,
  p_html        text,
  p_text        text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym      uuid;
  v_status   text;
  v_subject  text;
  v_audience jsonb;
  v_topic    uuid;
  v_count    integer;
begin
  -- FOR UPDATE serialises two concurrent Send clicks: the second one
  -- blocks here, then sees the post-update 'sending' status and bails on
  -- the status check below (0045, lost in 0062).
  select gym_id, status, subject, audience, topic_id
    into v_gym, v_status, v_subject, v_audience, v_topic
    from public.email_campaigns where id = p_campaign_id
    for update;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'Campaign cannot be sent from status %', v_status;
  end if;
  if length(trim(coalesce(v_subject, ''))) = 0 then
    raise exception 'Add a subject line before sending';
  end if;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, full_name, status)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued'
  from public.comms_audience_rows(v_gym, v_audience, v_topic) r
  on conflict (campaign_id, lower(email)) do nothing;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;
  if v_count = 0 then
    raise exception 'This audience has no members with a usable email address';
  end if;

  update public.email_campaigns
    set status          = 'sending',
        recipient_count = v_count,
        compiled_html   = p_html,
        compiled_text   = p_text,
        scheduled_for   = null,
        updated_at      = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

commit;
