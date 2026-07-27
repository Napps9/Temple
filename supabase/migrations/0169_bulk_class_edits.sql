-- Bulk class edits across a date range.
--
-- Cancelling a class has only ever been single-target: cancel_session
-- (0018) takes one session, cancel_recurrence_from / cancel_recurrence
-- end a series forever. Neither fits the case that actually drives this
-- — "we're shut 22 Dec to 3 Jan and back to normal on the 4th". Doing it
-- by hand means opening twenty classes one at a time.
--
-- Three things make a naive bulk loop wrong, and they are the whole
-- reason this file is as long as it is:
--
--   1. Recurrences materialise lazily to gyms.materialisation_horizon_weeks
--      (12 by default, 0049). A Christmas closure entered in July matches
--      zero classes because those classes do not exist yet.
--   2. Even after a sweep, the next extend_recurrence — or a coach adding
--      a one-off — puts classes straight back inside the closed period.
--   3. cancel_session tells the member nothing. Silently deleting one
--      booking is survivable; silently deleting a fortnight of them is
--      not.
--
-- So a closure is a STANDING WINDOW, exactly as request_cover_range
-- (0164) is for one coach's classes: the dates live on a gym_closures
-- row, existing classes inside it are cancelled now, and classes created
-- into it later are suppressed by a trigger. That is what makes "22 Dec
-- to 3 Jan" mean the same thing in July as it does in December.
--
-- Sections:
--   1. can_bulk_edit_classes            — new capability (owner/admin)
--   2. gym_closures                     — the standing window
--   3. class_change_notifications       — member-facing notice + queue
--   4. _suppress_session_in_closure     — the standing half
--   5. close_gym_dates                  — bulk cancel
--   6. lift_gym_closure                 — reopening
--   7. bulk_edit_sessions               — capacity / duration / time
--   8. inbox_unread_summary             — pick up the new unread count

begin;

-- ============================================================================
-- 1. can_bulk_edit_classes
-- ============================================================================
--
-- can_edit_classes already lets a coach cancel a class, so a separate key
-- needs a reason. It is blast radius: a closure cancels every class in
-- the gym for a fortnight and refunds every member who had booked one.
-- That is an owner/admin decision, not a per-coach one.
--
-- Whole body restated because default_capability is a single CASE; the
-- rest is verbatim from 0137.

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_manage_website'         then p_role = 'admin'
    when 'can_program_members'        then p_role in ('admin','coach')
    when 'can_review_ai_calls'        then p_role = 'admin'
    when 'can_bulk_edit_classes'      then p_role = 'admin'
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text)
  to authenticated;

-- ============================================================================
-- 2. gym_closures
-- ============================================================================
--
-- ends_on is INCLUSIVE — the operator types "3 Jan" and means every class
-- on the 3rd. The timestamptz window is derived at use time from
-- gyms.timezone rather than stored, so a gym that later corrects its
-- timezone gets the corrected window; the literal dates are what the
-- operator agreed to and never drift with the viewer's timezone.
--
-- Lifting sets lifted_at rather than deleting, so a reopened window stops
-- suppressing but the notifications that reference it survive.

create table public.gym_closures (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  reason     text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  lifted_at  timestamptz,
  lifted_by  uuid references public.profiles(id),
  constraint gym_closures_window_ck check (ends_on >= starts_on)
);

-- The suppression trigger's lookup path, on the class_sessions insert hot
-- path. Partial so bulk materialisation stays cheap.
create index gym_closures_live_idx
  on public.gym_closures(gym_id, starts_on, ends_on)
  where lifted_at is null;

alter table public.gym_closures enable row level security;

-- Members read it: a calendar that is simply empty for a fortnight is
-- worse than one that says why. No client writes — the RPCs below own
-- every write.
create policy gym_closures_member_select on public.gym_closures
  for select using (public.user_belongs_to(gym_id));

-- ============================================================================
-- 3. class_change_notifications
-- ============================================================================
--
-- Shape follows cover_notifications (0165) for the same reason: Postgres
-- makes no outbound HTTP, so the in-app notification IS the row we insert
-- (delivered instantly) and the email is enqueued 'queued' for the
-- send-class-change-notifications edge worker, invoked best-effort by the
-- client.
--
-- The one deviation is `body`. Cover notifications join back to live rows
-- at send time; the sessions this notification is about have just been
-- DELETED, so there is nothing left to join to. The digest line is
-- rendered at enqueue time and stored.
--
-- ONE notification per member per closure, not per class. A fortnight is
-- twenty-odd cancellations; twenty emails per member would train everyone
-- to filter the sender.

create table public.class_change_notifications (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  closure_id           uuid references public.gym_closures(id) on delete cascade,
  kind                 text not null
                         check (kind in ('gym_closed', 'classes_rescheduled')),
  channel              text not null check (channel in ('email', 'in_app')),
  recipient            text,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  body                 text not null,
  status               text not null default 'queued'
                         check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  error                text,
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  read_at              timestamptz
);

create index class_change_notifications_recipient_unread_idx
  on public.class_change_notifications(gym_id, recipient_profile_id)
  where channel = 'in_app' and read_at is null;

create index class_change_notifications_gym_queued_idx
  on public.class_change_notifications(gym_id, status)
  where channel = 'email' and status = 'queued';

alter table public.class_change_notifications enable row level security;

create policy class_change_notifications_self_select
  on public.class_change_notifications
  for select using (
    recipient_profile_id = auth.uid() or public.user_can_admin(gym_id)
  );

-- ============================================================================
-- 4. _suppress_session_in_closure
-- ============================================================================
--
-- The standing half of the window — the analogue of
-- _attach_session_to_standing_cover (0164 §4), but BEFORE INSERT rather
-- than AFTER. Before, because then the row is never created: there are no
-- bookings to refund, no cover offer to unpick, and nothing for the
-- calendar to briefly show. It also runs ahead of the cover auto-attach,
-- so a suppressed class never reaches the cover feed.
--
-- Two behaviours by provenance, and the split is deliberate:
--
--   recurrence_id is not null → return null, silently.
--     extend_recurrence walks whole date spans in one call. Raising would
--     abort the entire run, so a closure over Christmas would stop a gym
--     materialising anything at all past 22 Dec.
--
--   recurrence_id is null → raise.
--     A human is adding a one-off. Silently dropping it would show them a
--     success toast and no class.

create or replace function public._suppress_session_in_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.gym_closures;
  v_tz      text;
  v_why     text;
begin
  -- Backfilling history into a past closure window is legitimate (an
  -- attendance correction, an import). Only future classes are suppressed.
  if new.starts_at <= now() then
    return new;
  end if;

  select timezone into v_tz from public.gyms where id = new.gym_id;
  if v_tz is null then
    return new;
  end if;

  select c.* into v_closure
  from public.gym_closures c
  where c.gym_id = new.gym_id
    and c.lifted_at is null
    and new.starts_at >= (c.starts_on::text || ' 00:00')::timestamp at time zone v_tz
    and new.starts_at <  ((c.ends_on + 1)::text || ' 00:00')::timestamp at time zone v_tz
  order by c.created_at
  limit 1;

  if v_closure.id is null then
    return new;
  end if;

  if new.recurrence_id is not null then
    return null;
  end if;

  v_why := 'The gym is closed from '
    || to_char(v_closure.starts_on, 'FMDD Mon')
    || ' to ' || to_char(v_closure.ends_on, 'FMDD Mon')
    || case when v_closure.reason is null then ''
            else ' (' || v_closure.reason || ')' end;
  raise exception '%', v_why using errcode = 'P0001';
end;
$$;

create trigger class_sessions_suppress_in_closure
  before insert on public.class_sessions
  for each row execute function public._suppress_session_in_closure();

-- ============================================================================
-- 5. close_gym_dates
-- ============================================================================

-- Recipients are members holding a booking inside the window. Called
-- BEFORE the cancellations, because after them class_bookings is empty.
create or replace function public._enqueue_gym_closed(
  p_closure_id uuid,
  p_window_start timestamptz,
  p_window_end   timestamptz,
  p_exclude_session_ids uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.gym_closures;
  v_window  text;
  v_count   integer;
begin
  select * into v_closure from public.gym_closures where id = p_closure_id;
  if v_closure is null then
    return 0;
  end if;

  v_window := to_char(v_closure.starts_on, 'FMDD Mon')
              || ' to ' || to_char(v_closure.ends_on, 'FMDD Mon');

  with affected as (
    select b.profile_id, count(*)::int as class_count, u.email
    from public.class_bookings b
    join public.class_sessions cs on cs.id = b.class_session_id
    join auth.users u on u.id = b.profile_id
    where cs.gym_id    = v_closure.gym_id
      and cs.starts_at >  now()
      and cs.starts_at >= p_window_start
      and cs.starts_at <  p_window_end
      and not (cs.id = any(coalesce(p_exclude_session_ids, '{}'::uuid[])))
    group by b.profile_id, u.email
  )
  insert into public.class_change_notifications
    (gym_id, closure_id, kind, channel, recipient, recipient_profile_id,
     body, status, sent_at, error, idempotency_key)
  select
    v_closure.gym_id, p_closure_id, 'gym_closed', c.channel,
    case when c.channel = 'in_app' then a.profile_id::text else a.email end,
    a.profile_id,
    'The gym is closed ' || v_window
      || case when v_closure.reason is null then ''
              else ' (' || v_closure.reason || ')' end
      || '. ' || a.class_count
      || case when a.class_count = 1 then ' class you booked has'
              else ' classes you booked have' end
      || ' been cancelled and any credits used have been returned.',
    case
      when c.channel = 'in_app' then 'sent'
      when a.email is null then 'skipped'
      when public._email_blanket_unsubscribed(v_closure.gym_id, a.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and a.email is null then 'Member has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(v_closure.gym_id, a.email)
        then 'Member has unsubscribed from all email from this gym'
    end,
    c.channel || ':closed:' || p_closure_id || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  select count(distinct recipient_profile_id)::int into v_count
    from public.class_change_notifications
    where closure_id = p_closure_id and channel = 'in_app';

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function
  public._enqueue_gym_closed(uuid, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated;

--
-- p_exclude_session_ids is what lets a closure and a skeleton timetable
-- compose: pick the window, untick the two open-gym sessions you're still
-- running. Exclusions only apply to classes that exist at closure time,
-- which is exactly right — a class created later can't have been
-- unticked, and the trigger suppresses it anyway.
--
create or replace function public.close_gym_dates(
  p_gym_id              uuid,
  p_start               date,
  p_end                 date,
  p_reason              text,
  p_exclude_session_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_tz           text;
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_closure_id   uuid;
  v_notified     integer;
  v_cancelled    integer := 0;
  v_session_id   uuid;
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
  if not public.effective_can(p_gym_id, 'can_bulk_edit_classes') then
    raise exception 'Not authorised';
  end if;

  select timezone into v_tz from public.gyms where id = p_gym_id;
  if v_tz is null then
    raise exception 'Gym not found';
  end if;

  -- End-exclusive start of the following day, so "to 3rd January"
  -- includes every class on the 3rd whatever time it runs. Mirrors
  -- request_cover_range (0164) and src/lib/date-range.ts.
  v_window_start := (p_start::text || ' 00:00')::timestamp at time zone v_tz;
  v_window_end   := ((p_end + 1)::text || ' 00:00')::timestamp at time zone v_tz;
  if v_window_end <= now() then
    raise exception 'That date range is in the past';
  end if;

  -- Materialise before resolving, so a window past the horizon finds real
  -- classes. Runs before the closure row exists on purpose: the
  -- suppression trigger would otherwise stop the very classes we are
  -- trying to cancel from being created, and the closure would silently
  -- match nothing.
  perform public.extend_gym_recurrences(p_gym_id, p_end);

  insert into public.gym_closures
    (gym_id, starts_on, ends_on, reason, created_by)
  values
    (p_gym_id, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''), v_uid)
  returning id into v_closure_id;

  -- Notify first: _cancel_session_internal deletes the bookings this
  -- reads.
  v_notified := public._enqueue_gym_closed(
    v_closure_id, v_window_start, v_window_end, p_exclude_session_ids);

  for v_session_id in
    select cs.id
    from public.class_sessions cs
    where cs.gym_id    = p_gym_id
      and cs.starts_at >  now()
      and cs.starts_at >= v_window_start
      and cs.starts_at <  v_window_end
      and not (cs.id = any(coalesce(p_exclude_session_ids, '{}'::uuid[])))
    order by cs.starts_at
  loop
    perform public._cancel_session_internal(v_session_id);
    v_cancelled := v_cancelled + 1;
  end loop;

  return jsonb_build_object(
    'closure_id', v_closure_id,
    'cancelled',  v_cancelled,
    'notified',   v_notified
  );
end;
$$;

grant execute on function
  public.close_gym_dates(uuid, date, date, text, uuid[]) to authenticated;

-- ============================================================================
-- 6. lift_gym_closure
-- ============================================================================
--
-- Reopening. Bookings are NOT restored — the members were refunded and
-- have to rebook; a hard delete leaves nothing to reconstruct them from.
-- The classes themselves do come back, by rewinding each recurrence's
-- materialisation cursor over the window and re-running extend_recurrence.
-- class_sessions_recurrence_starts_unique plus extend_recurrence's own
-- `on conflict do nothing` make re-walking already-materialised days a
-- no-op, so only the deleted occurrences are re-created.
--
-- One-off classes cancelled by the closure stay gone: nothing records
-- what they were.

create or replace function public.lift_gym_closure(p_closure_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.gym_closures;
  v_rec     record;
  v_before  integer;
  v_after   integer;
  v_created integer := 0;
begin
  select * into v_closure from public.gym_closures where id = p_closure_id;
  if v_closure is null then
    raise exception 'Closure not found';
  end if;
  if not public.effective_can(v_closure.gym_id, 'can_bulk_edit_classes') then
    raise exception 'Not authorised';
  end if;
  if v_closure.lifted_at is not null then
    return 0;
  end if;

  -- Lift first: extend_recurrence below inserts into the very window the
  -- suppression trigger is watching.
  update public.gym_closures
    set lifted_at = now(), lifted_by = auth.uid()
    where id = p_closure_id;

  for v_rec in
    select id, materialized_until
    from public.class_recurrences
    where gym_id = v_closure.gym_id
      and materialized_until >= v_closure.starts_on
  loop
    select count(*)::int into v_before
      from public.class_sessions where recurrence_id = v_rec.id;

    update public.class_recurrences
      set materialized_until = (v_closure.starts_on - 1)
      where id = v_rec.id;
    perform public.extend_recurrence(v_rec.id, v_rec.materialized_until);

    select count(*)::int into v_after
      from public.class_sessions where recurrence_id = v_rec.id;
    v_created := v_created + (v_after - v_before);
  end loop;

  return v_created;
end;
$$;

grant execute on function public.lift_gym_closure(uuid) to authenticated;

-- ============================================================================
-- 7. bulk_edit_sessions
-- ============================================================================
--
-- The other half of "bulk edits across the week": a reduced holiday
-- timetable rather than a closure. p_session_ids null means every class in
-- the window; each value param is null for "leave unchanged".
--
-- Outcomes are COUNTED, not raised. One over-subscribed class in a
-- fortnight should not make the operator hunt for it and re-run — the
-- result tells them how many were skipped and why.

create or replace function public._enqueue_classes_rescheduled(
  p_gym_id       uuid,
  p_edit_key     text,
  p_session_ids  uuid[],
  p_body         text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with affected as (
    select distinct b.profile_id, u.email
    from public.class_bookings b
    join auth.users u on u.id = b.profile_id
    where b.class_session_id = any(p_session_ids)
  )
  insert into public.class_change_notifications
    (gym_id, kind, channel, recipient, recipient_profile_id,
     body, status, sent_at, error, idempotency_key)
  select
    p_gym_id, 'classes_rescheduled', c.channel,
    case when c.channel = 'in_app' then a.profile_id::text else a.email end,
    a.profile_id,
    p_body,
    case
      when c.channel = 'in_app' then 'sent'
      when a.email is null then 'skipped'
      when public._email_blanket_unsubscribed(p_gym_id, a.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and a.email is null then 'Member has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(p_gym_id, a.email)
        then 'Member has unsubscribed from all email from this gym'
    end,
    c.channel || ':rescheduled:' || p_edit_key || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0) / 2;
end;
$$;

revoke execute on function
  public._enqueue_classes_rescheduled(uuid, text, uuid[], text)
  from public, anon, authenticated;

create or replace function public.bulk_edit_sessions(
  p_gym_id           uuid,
  p_start            date,
  p_end              date,
  p_session_ids      uuid[],
  p_capacity         integer,
  p_duration_minutes integer,
  p_shift_minutes    integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz            text;
  v_window_start  timestamptz;
  v_window_end    timestamptz;
  v_sess          record;
  v_booked        integer;
  v_new_start     timestamptz;
  v_updated       integer := 0;
  v_overbooked    integer := 0;
  v_past          integer := 0;
  v_conflict      integer := 0;
  v_applied       boolean;
  v_moved         uuid[]  := '{}';
  v_edit_key      text;
  v_notified      integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_start is null or p_end is null then
    raise exception 'Pick a start and end date';
  end if;
  if p_end < p_start then
    raise exception 'End date is before the start date';
  end if;
  if p_capacity is null and p_duration_minutes is null and p_shift_minutes is null then
    raise exception 'Nothing to change';
  end if;
  if p_capacity is not null and p_capacity < 1 then
    raise exception 'Capacity must be at least 1';
  end if;
  if p_duration_minutes is not null and p_duration_minutes < 1 then
    raise exception 'Duration must be at least 1 minute';
  end if;
  if not public.effective_can(p_gym_id, 'can_bulk_edit_classes') then
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

  -- Shifting a run of classes by a constant moves each one onto the slot
  -- its neighbour is vacating, so an unordered pass transiently violates
  -- class_sessions_recurrence_starts_unique. Walk away from the direction
  -- of travel: latest first when moving later, earliest first when moving
  -- earlier.
  for v_sess in
    select cs.id, cs.starts_at
    from public.class_sessions cs
    where cs.gym_id    = p_gym_id
      and cs.starts_at >  now()
      and cs.starts_at >= v_window_start
      and cs.starts_at <  v_window_end
      and (p_session_ids is null or cs.id = any(p_session_ids))
    order by extract(epoch from cs.starts_at)
             * (case when coalesce(p_shift_minutes, 0) > 0 then -1 else 1 end)
  loop
    if p_capacity is not null then
      select count(*)::int into v_booked
        from public.class_bookings where class_session_id = v_sess.id;
      if p_capacity < v_booked then
        v_overbooked := v_overbooked + 1;
        continue;
      end if;
    end if;

    v_new_start := v_sess.starts_at
      + (coalesce(p_shift_minutes, 0) || ' minutes')::interval;
    if v_new_start <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    v_applied := true;
    begin
      update public.class_sessions
        set capacity         = coalesce(p_capacity, capacity),
            duration_minutes = coalesce(p_duration_minutes, duration_minutes),
            starts_at        = v_new_start
        where id = v_sess.id;
    exception when unique_violation then
      -- A partial selection shifted onto an unmoved sibling.
      v_conflict := v_conflict + 1;
      v_applied  := false;
    end;
    if not v_applied then
      continue;
    end if;

    v_updated := v_updated + 1;
    if p_shift_minutes is not null or p_duration_minutes is not null then
      v_moved := v_moved || v_sess.id;
    end if;
  end loop;

  -- Capacity alone is invisible to a member who already has a place, so
  -- it sends nothing. A time or length change is not.
  if cardinality(v_moved) > 0 then
    -- Keyed on the resulting times, not the requested shift: applying the
    -- same shift twice is a real second change and has to notify again,
    -- while a retry of the same call must not.
    select md5(p_gym_id::text || ':'
               || string_agg(id::text || '@' || starts_at::text, ',' order by id))
      into v_edit_key
      from public.class_sessions where id = any(v_moved);
    v_notified := public._enqueue_classes_rescheduled(
      p_gym_id, v_edit_key, v_moved,
      'Some of the classes you have booked between '
        || to_char(p_start, 'FMDD Mon') || ' and ' || to_char(p_end, 'FMDD Mon')
        || ' have changed time or length. Check your bookings for the new times.');
  end if;

  return jsonb_build_object(
    'updated',            v_updated,
    'skipped_overbooked', v_overbooked,
    'skipped_past',       v_past,
    'skipped_conflict',   v_conflict,
    'notified',           v_notified
  );
end;
$$;

grant execute on function
  public.bulk_edit_sessions(uuid, date, date, uuid[], integer, integer, integer)
  to authenticated;

-- ============================================================================
-- 8. Read surface + inbox rollup
-- ============================================================================

create or replace function public.mark_class_change_notifications_read(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.class_change_notifications
    set read_at = now(), status = 'read'
    where gym_id = p_gym_id
      and channel = 'in_app'
      and recipient_profile_id = auth.uid()
      and read_at is null;
end;
$$;

grant execute on function public.mark_class_change_notifications_read(uuid)
  to authenticated;

-- RETURNS TABLE gains a column, and CREATE OR REPLACE cannot change a
-- function's return shape (0043). Drop first.
drop function if exists public.inbox_unread_summary();

create function public.inbox_unread_summary()
returns table (
  dm_unread              integer,
  announcement_unread    integer,
  class_broadcast_unread integer,
  class_change_unread    integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::int from public.direct_messages
      where recipient_id = auth.uid() and read_at is null
    ),
    (
      select count(*)::int from public.gym_announcements a
      where exists (
        select 1 from public.gym_memberships gm
        where gm.gym_id = a.gym_id
          and gm.profile_id = auth.uid()
          and gm.left_at is null
      )
      and not exists (
        select 1 from public.announcement_reads r
        where r.announcement_id = a.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_session_broadcasts cb
      where exists (
        select 1 from public.class_bookings b
        where b.class_session_id = cb.class_session_id
          and b.profile_id = auth.uid()
      )
      and not exists (
        select 1 from public.class_session_broadcast_reads r
        where r.broadcast_id = cb.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_change_notifications n
      where n.channel = 'in_app'
        and n.recipient_profile_id = auth.uid()
        and n.read_at is null
    );
$$;

grant execute on function public.inbox_unread_summary() to authenticated;

commit;
