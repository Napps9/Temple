-- Members find out when their coach changes
--
-- class_change_notifications has told people about a closed gym, a moved
-- class, a reopened one and a cancelled one since 0169/0212. It has never
-- told them the one change they are most likely to care about, because a
-- coach is often why somebody booked: who is taking it.
--
-- There was no kind for it, and neither writer called anything.
-- claim_cover (0165) has reassigned coaches since the cover flow existed
-- and notifies the coach who asked and nobody else. set_session_coach
-- (0224) added assignment this morning and said so on its card —
-- "members booked in are not told" — which was honest and is now wrong.
--
-- Both writers, one fix. Notifying on one path and not the other would
-- make cover and assignment behave differently for the same visible
-- event, which is worse than either alone: a member would learn about a
-- swap and not about a reassignment, with no way to know why.

alter table public.class_change_notifications
  drop constraint if exists class_change_notifications_kind_check;

alter table public.class_change_notifications
  add constraint class_change_notifications_kind_check
  check (kind in ('gym_closed', 'classes_rescheduled', 'classes_reopened',
                  'class_cancelled', 'class_coach_changed'));

-- ---------------------------------------------------------------------------
-- The notice
-- ---------------------------------------------------------------------------
--
-- Shaped like _enqueue_class_cancelled (0212): one in_app row marked sent
-- and one email row queued per booked member, blanket unsubscribes
-- honoured as 'skipped' with the reason recorded rather than dropped
-- silently. The dispatcher needs no teaching — it sends whatever body is
-- queued and does not branch on kind.
--
-- Only future classes. A coach corrected on last Tuesday's register is a
-- bookkeeping fix, and mailing forty people about who taught a class they
-- have already been to is noise dressed as service.
--
-- The idempotency key is the session plus the incoming coach, so a
-- retried write cannot mail twice. The known edge: a class flipped from
-- Marcus to Jo and back to Marcus does not re-announce Marcus, because
-- that key was already used. Both writers refuse a no-op change, so this
-- only shows up in a genuine there-and-back, and under-telling is the
-- right way to be wrong here.

create or replace function public._enqueue_class_coach_changed(
  p_session_id uuid,
  p_coach_id   uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_when   text;
  v_what   text;
  v_who    text;
  v_count  integer;
begin
  select cs.gym_id,
         to_char(cs.starts_at, 'FMDay FMDD Mon') || ' at ' ||
           to_char(cs.starts_at, 'HH24:MI'),
         coalesce(ct.name, cs.name, 'class')
    into v_gym_id, v_when, v_what
    from public.class_sessions cs
    left join public.class_types ct on ct.id = cs.class_type_id
    where cs.id = p_session_id
      and cs.starts_at > now();

  if v_gym_id is null then
    return 0;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'a different coach')
    into v_who
    from public.profiles p where p.id = p_coach_id;

  with affected as (
    select b.profile_id, u.email
    from public.class_bookings b
    join auth.users u on u.id = b.profile_id
    where b.class_session_id = p_session_id
  )
  insert into public.class_change_notifications
    (gym_id, closure_id, kind, channel, recipient, recipient_profile_id,
     body, status, sent_at, error, idempotency_key)
  select
    v_gym_id, null, 'class_coach_changed', c.channel,
    case when c.channel = 'in_app' then a.profile_id::text else a.email end,
    a.profile_id,
    'Your ' || v_what || ' on ' || v_when || ' will be taken by '
      || coalesce(v_who, 'a different coach')
      || '. Same time, same place, and your spot is kept.',
    case
      when c.channel = 'in_app' then 'sent'
      when a.email is null then 'skipped'
      when public._email_blanket_unsubscribed(v_gym_id, a.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and a.email is null
        then 'Member has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(v_gym_id, a.email)
        then 'Member has unsubscribed from all email from this gym'
    end,
    c.channel || ':coach:' || p_session_id || ':' || p_coach_id
      || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  select count(*)::int into v_count
    from public.class_change_notifications
    where kind = 'class_coach_changed'
      and channel = 'in_app'
      and idempotency_key like
            'in_app:coach:' || p_session_id || ':' || p_coach_id || ':%';

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public._enqueue_class_coach_changed(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Both writers call it
-- ---------------------------------------------------------------------------
--
-- 0224's function and 0165's, each restated with one line added.

create or replace function public.set_session_coach(
  p_session_id uuid,
  p_coach_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.class_sessions;
  v_role    public.gym_role;
  v_clash   integer;
begin
  select * into v_session
    from public.class_sessions where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'That class is not there any more';
  end if;
  if not public.effective_can(v_session.gym_id, 'can_edit_classes') then
    raise exception 'Not authorised';
  end if;
  if v_session.coach_id is not distinct from p_coach_id then
    return;
  end if;

  select role into v_role
    from public.gym_memberships
    where gym_id = v_session.gym_id and profile_id = p_coach_id
      and left_at is null;
  if v_role is null then
    raise exception 'They are not at this gym';
  end if;
  -- user_can_cover's rule, and its reason: admins do not coach.
  if v_role not in ('owner', 'coach') then
    raise exception 'Only an owner or a coach can be put on a class';
  end if;

  if v_session.class_type_id is not null and exists (
    select 1 from public.coach_class_type_qualifications q
      where q.gym_id = v_session.gym_id
        and q.profile_id = p_coach_id
        and q.class_type_id = v_session.class_type_id
        and q.qualified = false
  ) then
    raise exception 'They are not qualified to take that class';
  end if;

  select count(*) into v_clash
    from public.class_sessions cs
    where cs.coach_id = p_coach_id
      and cs.id <> p_session_id
      and cs.starts_at
          < v_session.starts_at
            + (v_session.duration_minutes || ' minutes')::interval
      and cs.starts_at + (cs.duration_minutes || ' minutes')::interval
          > v_session.starts_at;
  if v_clash > 0 then
    raise exception 'They are already coaching at that time';
  end if;

  update public.class_sessions
    set coach_id = p_coach_id
    where id = p_session_id;

  perform public._enqueue_class_coach_changed(p_session_id, p_coach_id);
end;
$$;

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
  -- The requesting coach already learns who took it. Until now the
  -- members booked in did not, and cover is exactly when they most want
  -- to: it is the short-notice change.
  perform public._enqueue_class_coach_changed(v_session.id, v_uid);
end;
$$;
