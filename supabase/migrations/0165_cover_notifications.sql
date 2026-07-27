-- Notifications for cover requests.
--
-- Cover (0013/0014/0036/0164) has never notified anyone. A coach lodges a
-- request and it sits there; discovery is entirely "another coach happens
-- to open /management/cover". That was survivable when a request meant
-- one class, and stops being survivable now that 0164 lets a coach hand
-- over a fortnight at a time.
--
-- Two events, chosen because they are the two ends of the loop:
--   * cover_requested — the gym's other coaches learn there is cover to
--     claim.
--   * cover_claimed   — the requester learns a class is actually covered,
--     and by whom.
--
-- ONE notification per REQUEST, not per class. A 14-day range is twenty-
-- odd offers; twenty emails per coach per holiday would train everyone to
-- filter the sender. The digest names the window and the class count and
-- links to the feed.
--
-- Shape follows lead_notifications (0114) exactly, for the same reasons:
-- Postgres makes no outbound HTTP, so the in-app notification IS the row
-- we insert (delivered instantly) and the email is enqueued 'queued' for
-- the send-cover-notifications edge worker, invoked best-effort by the
-- client. Every attempt is logged, failures are visible, and the
-- idempotency key makes a retry a no-op.
--
-- Sections:
--   1. cover_notifications table + RLS
--   2. _enqueue_cover_requested   — internal fan-out to claimable coaches
--   3. _enqueue_cover_claimed     — internal, back to the requester
--   4. request_cover / request_cover_range / claim_cover call them
--   5. count_unread_cover_notifications / mark_cover_notification_read
--
-- Suppression: email_unsubscribes is the CAMPAIGN preference system
-- (0044/0058) and send-lead-notifications deliberately ignores it for
-- staff operational mail. Cover splits the difference — a BLANKET
-- unsubscribe (topic_id is null, "send me nothing") suppresses the cover
-- email, recorded as 'skipped' so it is visible rather than silently
-- lost, but never the in-app row. Someone who opted out of the newsletter
-- still sees cover in the app; they just don't get mailed about it.

begin;

-- ============================================================================
-- 1. cover_notifications
-- ============================================================================

create table public.cover_notifications (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  request_id           uuid not null references public.cover_requests(id) on delete cascade,
  offer_id             uuid references public.cover_request_sessions(id) on delete cascade,
  kind                 text not null
                         check (kind in ('cover_requested', 'cover_claimed')),
  channel              text not null check (channel in ('email', 'in_app')),
  recipient            text,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  status               text not null default 'queued'
                         check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  error                text,
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  read_at              timestamptz
);

create index cover_notifications_recipient_unread_idx
  on public.cover_notifications(gym_id, recipient_profile_id)
  where channel = 'in_app' and read_at is null;

create index cover_notifications_gym_queued_idx
  on public.cover_notifications(gym_id, status)
  where channel = 'email' and status = 'queued';

create index cover_notifications_request_idx
  on public.cover_notifications(request_id);

alter table public.cover_notifications enable row level security;

-- Your own notifications, plus admins for the retry surface. No client
-- INSERT/UPDATE at all — the RPCs below own every write.
create policy cover_notifications_self_select on public.cover_notifications
  for select using (
    recipient_profile_id = auth.uid() or public.user_can_admin(gym_id)
  );

-- ============================================================================
-- 2. _enqueue_cover_requested
-- ============================================================================

-- Blanket suppression only: a topic-scoped unsubscribe is about campaigns
-- under that topic, and cover is not a campaign.
create or replace function public._email_blanket_unsubscribed(
  p_gym_id uuid,
  p_email  text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.email_unsubscribes eu
    where eu.gym_id = p_gym_id
      and lower(eu.email) = lower(p_email)
      and eu.topic_id is null
  );
$$;

revoke execute on function public._email_blanket_unsubscribed(uuid, text)
  from public, anon, authenticated;

--
-- Recipients are the people who could actually claim: owner + coach
-- (user_can_cover's own definition), minus the requester, minus anyone
-- disqualified for every class type in the request — a coach who cannot
-- claim a single one of these classes gains nothing from being told.
--
-- Idempotency key is per (request, recipient), so re-running is a no-op
-- and a second request by the same coach still notifies.

create or replace function public._enqueue_cover_requested(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.cover_requests;
begin
  select * into v_request from public.cover_requests where id = p_request_id;
  if v_request is null then
    return;
  end if;

  with recipient as (
    select m.profile_id, u.email
    from public.gym_memberships m
    join auth.users u on u.id = m.profile_id
    where m.gym_id = v_request.gym_id
      and m.role in ('owner', 'coach')
      -- user_can_cover checks role alone, so a departed coach could
      -- technically still claim. Mailing someone who has left the gym is
      -- worse than that quirk, so notifications stop at the door.
      and m.left_at is null
      and m.profile_id <> v_request.requested_by
      -- At least one class in the request this coach is not barred from.
      and exists (
        select 1
        from public.cover_request_sessions crs
        join public.class_sessions cs on cs.id = crs.class_session_id
        where crs.request_id = p_request_id
          and not exists (
            select 1 from public.coach_class_type_qualifications q
            where q.gym_id = v_request.gym_id
              and q.profile_id = m.profile_id
              and q.class_type_id = cs.class_type_id
              and q.qualified = false
          )
      )
  )
  insert into public.cover_notifications
    (gym_id, request_id, kind, channel, recipient, recipient_profile_id,
     status, sent_at, error, idempotency_key)
  select
    v_request.gym_id, p_request_id, 'cover_requested', c.channel,
    case when c.channel = 'in_app' then r.profile_id::text else r.email end,
    r.profile_id,
    case
      when c.channel = 'in_app' then 'sent'
      when r.email is null then 'skipped'
      when public._email_blanket_unsubscribed(v_request.gym_id, r.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and r.email is null then 'Coach has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(v_request.gym_id, r.email)
        then 'Coach has unsubscribed from all email from this gym'
    end,
    c.channel || ':requested:' || p_request_id || ':' || r.profile_id
  from recipient r
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function public._enqueue_cover_requested(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 3. _enqueue_cover_claimed
-- ============================================================================
--
-- One recipient: the coach who asked. Keyed on the offer, so each class
-- covered produces exactly one notification — this half genuinely is
-- per-class, because "which of my classes is now covered, and by whom" is
-- the information the requester needs.

create or replace function public._enqueue_cover_claimed(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.cover_request_sessions;
  v_email text;
begin
  select * into v_offer from public.cover_request_sessions where id = p_offer_id;
  if v_offer is null or v_offer.original_coach_id is null then
    return;
  end if;

  select u.email into v_email
    from auth.users u where u.id = v_offer.original_coach_id;

  insert into public.cover_notifications
    (gym_id, request_id, offer_id, kind, channel, recipient,
     recipient_profile_id, status, sent_at, error, idempotency_key)
  values
    (v_offer.gym_id, v_offer.request_id, p_offer_id, 'cover_claimed', 'in_app',
     v_offer.original_coach_id::text, v_offer.original_coach_id, 'sent', now(), null,
     'in_app:claimed:' || p_offer_id),
    (v_offer.gym_id, v_offer.request_id, p_offer_id, 'cover_claimed', 'email',
     v_email, v_offer.original_coach_id,
     case
       when v_email is null then 'skipped'
       when public._email_blanket_unsubscribed(v_offer.gym_id, v_email) then 'skipped'
       else 'queued'
     end,
     null,
     case
       when v_email is null then 'Coach has no email address'
       when public._email_blanket_unsubscribed(v_offer.gym_id, v_email)
         then 'Coach has unsubscribed from all email from this gym'
     end,
     'email:claimed:' || p_offer_id)
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function public._enqueue_cover_claimed(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 4. Wire the enqueues into the three cover RPCs
-- ============================================================================
--
-- All three keep their signatures, so CREATE OR REPLACE is safe. The
-- bodies are otherwise identical to 0164 (request_cover,
-- request_cover_range) and 0036 (claim_cover).

create or replace function public.request_cover(
  p_session_ids uuid[],
  p_notes       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid;
  v_gym_id        uuid;
  v_gym_count     integer;
  v_request_id    uuid;
  v_range_start   timestamptz;
  v_range_end     timestamptz;
  v_session_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'No sessions selected';
  end if;

  with sess as (
    select cs.id, cs.gym_id, cs.coach_id, cs.starts_at, cs.duration_minutes
    from public.class_sessions cs
    where cs.id = any(p_session_ids)
  )
  select
    (array_agg(distinct gym_id))[1],
    count(distinct gym_id),
    min(starts_at),
    max(starts_at + (duration_minutes || ' minutes')::interval),
    count(*) filter (where coach_id = v_uid)
  into v_gym_id, v_gym_count, v_range_start, v_range_end, v_session_count
  from sess;

  if v_session_count is null or v_session_count <> cardinality(p_session_ids) then
    raise exception 'Can only request cover for classes you coach';
  end if;
  if v_gym_count <> 1 then
    raise exception 'All classes must belong to the same gym';
  end if;
  if not public.user_can_cover(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, notes)
  values
    (v_gym_id, v_uid, v_range_start, v_range_end, p_notes)
  returning id into v_request_id;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  select v_request_id, sid, v_uid, v_gym_id
  from unnest(p_session_ids) as sid;

  perform public._enqueue_cover_requested(v_request_id);

  return v_request_id;
end;
$$;

grant execute on function public.request_cover(uuid[], text) to authenticated;

create or replace function public.request_cover_range(
  p_gym_id              uuid,
  p_start               date,
  p_end                 date,
  p_exclude_session_ids uuid[],
  p_notes               text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_tz           text;
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_request_id   uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_start is null or p_end is null then
    raise exception 'Pick a start and end date';
  end if;
  if p_end < p_start then
    raise exception 'End date is before the start date';
  end if;
  if not public.user_can_cover(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  select timezone into v_tz from public.gyms where id = p_gym_id;
  if v_tz is null then
    raise exception 'Gym not found';
  end if;

  v_window_start := (p_start::text || ' 00:00')::timestamp at time zone v_tz;
  v_window_end   := ((p_end + 1)::text || ' 00:00')::timestamp at time zone v_tz;
  if v_window_end <= now() then
    raise exception 'That date range is in the past';
  end if;

  perform public.extend_gym_recurrences(p_gym_id, p_end);

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, notes,
     requested_start, requested_end)
  values
    (p_gym_id, v_uid, v_window_start, v_window_end, p_notes,
     p_start, p_end)
  returning id into v_request_id;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  select v_request_id, cs.id, v_uid, p_gym_id
  from public.class_sessions cs
  where cs.gym_id    = p_gym_id
    and cs.coach_id  = v_uid
    and cs.starts_at >= greatest(v_window_start, now())
    and cs.starts_at <  v_window_end
    and not (cs.id = any(coalesce(p_exclude_session_ids, '{}'::uuid[])))
    and not exists (
      select 1 from public.cover_request_sessions x
      where x.class_session_id = cs.id and x.claimed_by is null
    );

  -- A standing window with nothing in it yet has nothing to offer anyone,
  -- so there is nothing worth mailing about. The auto-attach trigger from
  -- 0164 does not notify either: classes trickling into an open window are
  -- not news, and a drip of one email per materialised class is exactly
  -- what the per-request digest exists to avoid.
  if exists (
    select 1 from public.cover_request_sessions where request_id = v_request_id
  ) then
    perform public._enqueue_cover_requested(v_request_id);
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.request_cover_range(uuid, date, date, uuid[], text)
  to authenticated;

create or replace function public.claim_cover(p_session_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid;
  v_offer         public.cover_request_sessions;
  v_session       public.class_sessions;
  v_overlap_count integer;
  v_open_siblings integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_offer
    from public.cover_request_sessions
    where id = p_session_offer_id and claimed_by is null
    for update;
  if v_offer is null then
    raise exception 'Offer already claimed or cancelled';
  end if;

  if not public.user_can_cover(v_offer.gym_id) then
    raise exception 'Not authorised';
  end if;
  if v_offer.original_coach_id = v_uid then
    raise exception 'You cannot cover your own class';
  end if;

  select * into v_session
    from public.class_sessions
    where id = v_offer.class_session_id
    for update;
  if v_session is null then
    raise exception 'Class session not found';
  end if;
  if v_session.coach_id is distinct from v_offer.original_coach_id then
    raise exception 'Class coach changed since the offer was created';
  end if;

  if v_session.class_type_id is not null and exists (
    select 1 from public.coach_class_type_qualifications q
    where q.gym_id = v_offer.gym_id
      and q.profile_id = v_uid
      and q.class_type_id = v_session.class_type_id
      and q.qualified = false
  ) then
    raise exception 'You are not qualified to cover this class type';
  end if;

  select count(*) into v_overlap_count
    from public.class_sessions cs
    where cs.coach_id = v_uid
      and cs.id <> v_session.id
      and cs.starts_at < v_session.starts_at + (v_session.duration_minutes || ' minutes')::interval
      and cs.starts_at + (cs.duration_minutes || ' minutes')::interval > v_session.starts_at;
  if v_overlap_count > 0 then
    raise exception 'You are already coaching at that time';
  end if;

  update public.class_sessions
    set coach_id = v_uid
    where id = v_session.id;

  update public.cover_request_sessions
    set claimed_by = v_uid, claimed_at = now()
    where id = v_offer.id;

  select count(*) into v_open_siblings
    from public.cover_request_sessions
    where request_id = v_offer.request_id and claimed_by is null;

  update public.cover_requests
    set status = case when v_open_siblings = 0 then 'claimed' else 'partial' end
    where id = v_offer.request_id;

  perform public._enqueue_cover_claimed(v_offer.id);
end;
$$;

grant execute on function public.claim_cover(uuid) to authenticated;

-- ============================================================================
-- 5. Read surface
-- ============================================================================

create or replace function public.count_unread_cover_notifications(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.cover_notifications
  where gym_id = p_gym_id
    and channel = 'in_app'
    and recipient_profile_id = auth.uid()
    and read_at is null;
$$;

grant execute on function public.count_unread_cover_notifications(uuid) to authenticated;

-- Marking read is self-only: the WHERE clause is the authorisation.
create or replace function public.mark_cover_notifications_read(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.cover_notifications
    set read_at = now(), status = 'read'
    where gym_id = p_gym_id
      and channel = 'in_app'
      and recipient_profile_id = auth.uid()
      and read_at is null;
end;
$$;

grant execute on function public.mark_cover_notifications_read(uuid) to authenticated;

commit;
