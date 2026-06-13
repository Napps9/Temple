-- Phase 4b — member self-service for email preferences.
--
-- The staff-side topic editor (0058) and the topic-aware audience
-- resolver (0059) are in place. This migration adds the three RPCs
-- the member-facing preferences screen calls:
--
--   - list_my_email_preferences(p_gym_id)
--     For the signed-in user, return one row per non-archived topic
--     plus a blanket flag. subscribed = true when no row exists in
--     email_unsubscribes for that (gym, email, topic). blanket_unsub
--     = true when the gym-wide "stop everything" row is present.
--
--   - set_my_email_topic_subscription(gym, topic, subscribed)
--     Toggle a per-topic unsubscribe. Re-subscribing also clears any
--     blanket row, because the member is telling us they want at
--     least this topic; staying blanket-off here would silently
--     suppress the very topic they just opted into.
--
--   - set_my_email_blanket_unsub(gym, unsubscribed)
--     The master toggle. true = insert blanket row (suppress
--     everything). false = clear the blanket; per-topic preferences
--     remain.
--
-- All three insist on a current gym membership for the caller and on
-- a non-empty auth.users.email to anchor the suppression row to.

begin;

-- ============================================================================
-- 1. list_my_email_preferences
-- ============================================================================

create or replace function public.list_my_email_preferences(p_gym_id uuid)
returns table (
  topic_id      uuid,
  label         text,
  description   text,
  subscribed    boolean,
  blanket_unsub boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_blanket boolean;
begin
  if v_uid is null then
    return;
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    return;
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    return;
  end if;

  v_blanket := exists (
    select 1 from public.email_unsubscribes eu
    where eu.gym_id = p_gym_id
      and lower(eu.email) = v_email
      and eu.topic_id is null
  );

  return query
  select t.id,
         t.label,
         t.description,
         not exists (
           select 1 from public.email_unsubscribes eu
           where eu.gym_id = p_gym_id
             and lower(eu.email) = v_email
             and eu.topic_id = t.id
         ) and not v_blanket,
         v_blanket
  from public.gym_email_topics t
  where t.gym_id = p_gym_id and t.archived_at is null
  order by t.sort_order, t.created_at;
end;
$$;
grant execute on function public.list_my_email_preferences(uuid) to authenticated;

-- ============================================================================
-- 2. set_my_email_topic_subscription
-- ============================================================================

create or replace function public.set_my_email_topic_subscription(
  p_gym_id     uuid,
  p_topic_id   uuid,
  p_subscribed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    raise exception 'No email on account';
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not a member';
  end if;
  if not exists (
    select 1 from public.gym_email_topics
    where id = p_topic_id and gym_id = p_gym_id and archived_at is null
  ) then
    raise exception 'Topic not found';
  end if;

  if p_subscribed then
    -- Subscribing implicitly clears the blanket too — otherwise the
    -- member's "yes" to this topic would silently lose to the master
    -- "no". Other per-topic preferences stay as-is.
    delete from public.email_unsubscribes
      where gym_id = p_gym_id
        and lower(email) = v_email
        and (topic_id = p_topic_id or topic_id is null);
  else
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, topic_id, reason)
    values (p_gym_id, v_email, v_uid, p_topic_id, 'member preference')
    on conflict (gym_id, lower(email), topic_id) where topic_id is not null do nothing;
  end if;
end;
$$;
grant execute on function public.set_my_email_topic_subscription(uuid, uuid, boolean) to authenticated;

-- ============================================================================
-- 3. set_my_email_blanket_unsub
-- ============================================================================

create or replace function public.set_my_email_blanket_unsub(
  p_gym_id       uuid,
  p_unsubscribed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    raise exception 'No email on account';
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not a member';
  end if;

  if p_unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, topic_id, reason)
    values (p_gym_id, v_email, v_uid, null, 'member blanket')
    on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  else
    delete from public.email_unsubscribes
      where gym_id = p_gym_id
        and lower(email) = v_email
        and topic_id is null;
  end if;
end;
$$;
grant execute on function public.set_my_email_blanket_unsub(uuid, boolean) to authenticated;

commit;
