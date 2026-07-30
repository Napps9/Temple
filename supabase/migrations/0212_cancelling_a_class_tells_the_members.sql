-- Cancelling a class tells the members, and the emails actually leave.
--
-- Two holes, found while mapping this area for the chat's classes module.
-- Both predate it and both affect members today.
--
-- 1. CANCELLING A SINGLE CLASS NOTIFIES NOBODY. close_gym_dates,
--    bulk_edit_sessions and reopen_closure all enqueue class_change_
--    notifications. cancel_session, cancel_recurrence_from and
--    cancel_recurrence — the three an owner or coach actually reaches for
--    when one class is off — enqueue nothing. The session row goes, the
--    bookings cascade away, credits are returned, and the member finds out
--    by turning up. Their booking does not even show as cancelled; it
--    simply stops existing.
--
-- 2. THE EMAILS HAVE NO DISPATCHER. Every other queue in this repo got a
--    cron — cover in 0198, campaigns in 0184, automations in 0117.
--    class_change_notifications never did. `status = 'queued'` email rows
--    leave only if a client happens to call drainClassChangeEmails, which
--    two staff screens do on mount (ClassesCalendar, operating). So a
--    closure announced at 9pm sends when a staff member next opens the
--    calendar, and if nobody does, never. In-app rows were always fine —
--    they are written 'sent' and read from the table.
--
-- The enqueue has to run BEFORE the cancel, because the recipients are the
-- people whose bookings the cancel is about to delete. That ordering is the
-- whole reason this is a wrapper around _cancel_session_internal rather
-- than something inside it: the internal function is also the closure path,
-- which has already enqueued its own, differently-worded notice.
--
-- Wording follows _enqueue_gym_closed (0169): what happened, what it means
-- for their credit, in one sentence a member reads on their phone. Same
-- suppression rules — no address is a 'skipped' row with a reason, not a
-- silent drop, and a blanket unsubscribe is honoured.

begin;

-- ============================================================================
-- 1. A cancellation is a kind of class change
-- ============================================================================

alter table public.class_change_notifications
  drop constraint if exists class_change_notifications_kind_check;

alter table public.class_change_notifications
  add constraint class_change_notifications_kind_check
  check (kind in ('gym_closed', 'classes_rescheduled', 'classes_reopened',
                  'class_cancelled'));

-- ============================================================================
-- 2. _enqueue_class_cancelled
-- ============================================================================
--
-- Returns the number of members told, which is what the caller reports back.
-- Runs while the bookings still exist; calling it after the cancel silently
-- tells nobody, because there is nobody left to find.

create or replace function public._enqueue_class_cancelled(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id  uuid;
  v_when    text;
  v_what    text;
  v_count   integer;
begin
  select cs.gym_id,
         to_char(cs.starts_at, 'FMDay FMDD Mon') || ' at ' ||
           to_char(cs.starts_at, 'HH24:MI'),
         coalesce(ct.name, cs.name, 'class')
    into v_gym_id, v_when, v_what
    from public.class_sessions cs
    left join public.class_types ct on ct.id = cs.class_type_id
    where cs.id = p_session_id;

  if v_gym_id is null then
    return 0;
  end if;

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
    v_gym_id, null, 'class_cancelled', c.channel,
    case when c.channel = 'in_app' then a.profile_id::text else a.email end,
    a.profile_id,
    'Your ' || v_what || ' on ' || v_when
      || ' has been cancelled. The credit you used has been returned.',
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
    c.channel || ':cancelled:' || p_session_id || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  select count(*)::int into v_count
    from public.class_change_notifications
    where kind = 'class_cancelled'
      and channel = 'in_app'
      and idempotency_key like 'in_app:cancelled:' || p_session_id || ':%';

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public._enqueue_class_cancelled(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 3. cancel_session tells them
-- ============================================================================
--
-- Body is 0018's verbatim apart from the enqueue and the return value. The
-- return was `1` — a constant nothing read; it now carries how many people
-- were told, so a caller can say so rather than guess.
--
-- Signature and return type are unchanged (integer), so CREATE OR REPLACE
-- is safe here.

create or replace function public.cancel_session(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id    uuid;
  v_starts_at timestamptz;
  v_told      integer;
begin
  select gym_id, starts_at into v_gym_id, v_starts_at
    from public.class_sessions where id = p_session_id;
  if v_gym_id is null then
    raise exception 'Session not found' using errcode = 'P0001';
  end if;
  if not public.user_can_admin_or_coach(v_gym_id) then
    raise exception 'Not authorised' using errcode = 'P0001';
  end if;
  if v_starts_at <= now() then
    raise exception 'Cannot cancel a session that has already started'
      using errcode = 'P0001';
  end if;

  -- Before, not after: these are the people whose bookings are about to go.
  v_told := public._enqueue_class_cancelled(p_session_id);

  perform public._cancel_session_internal(p_session_id);
  return v_told;
end;
$$;

-- ============================================================================
-- 4. And so do the two recurrence cancels
-- ============================================================================
--
-- Both bodies are 0018's verbatim with one line added inside the loop, so
-- the recurrence bookkeeping each does afterwards survives: cancel_recurrence_from
-- truncates the pattern's ends_on so extend_recurrence cannot re-create what
-- was just cancelled, and cancel_recurrence deletes the pattern row outright.
-- Losing either would have future occurrences quietly reappear.
--
-- Note cancel_recurrence_from takes a SESSION id, not a recurrence id — it
-- means "this one and every one after it". Signatures and return types are
-- unchanged, so CREATE OR REPLACE is safe.

create or replace function public.cancel_recurrence_from(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id        uuid;
  v_starts_at     timestamptz;
  v_recurrence_id uuid;
  v_count         int := 0;
  v_sib_id        uuid;
begin
  select gym_id, starts_at, recurrence_id
    into v_gym_id, v_starts_at, v_recurrence_id
    from public.class_sessions where id = p_session_id;
  if v_gym_id is null then
    raise exception 'Session not found' using errcode = 'P0001';
  end if;
  if not public.user_can_admin_or_coach(v_gym_id) then
    raise exception 'Not authorised' using errcode = 'P0001';
  end if;
  if v_starts_at <= now() then
    raise exception 'Cannot cancel a session that has already started' using errcode = 'P0001';
  end if;
  if v_recurrence_id is null then
    raise exception 'Session is not part of a recurrence' using errcode = 'P0001';
  end if;

  -- Cancel this + every future sibling. starts_at > now() filters out any
  -- past sibling that might somehow share starts_at = v_starts_at with this
  -- one (unique constraint forbids it, but the guard is cheap).
  for v_sib_id in
    select id from public.class_sessions
    where recurrence_id = v_recurrence_id
      and starts_at    >= v_starts_at
      and starts_at    >  now()
    order by starts_at
  loop
    perform public._enqueue_class_cancelled(v_sib_id);
    perform public._cancel_session_internal(v_sib_id);
    v_count := v_count + 1;
  end loop;

  -- Truncate the recurrence so extend_recurrence / copy_week_forward don't
  -- re-create the cancelled occurrences.
  update public.class_recurrences
    set ends_on = (v_starts_at::date - interval '1 day')::date
    where id = v_recurrence_id;

  return v_count;
end;
$$;

create or replace function public.cancel_recurrence(p_recurrence_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_count  int := 0;
  v_sib_id uuid;
begin
  select gym_id into v_gym_id
    from public.class_recurrences where id = p_recurrence_id;
  if v_gym_id is null then
    raise exception 'Recurrence not found' using errcode = 'P0001';
  end if;
  if not public.user_can_admin_or_coach(v_gym_id) then
    raise exception 'Not authorised' using errcode = 'P0001';
  end if;

  for v_sib_id in
    select id from public.class_sessions
    where recurrence_id = p_recurrence_id
      and starts_at    >  now()
    order by starts_at
  loop
    perform public._enqueue_class_cancelled(v_sib_id);
    perform public._cancel_session_internal(v_sib_id);
    v_count := v_count + 1;
  end loop;

  -- Delete the recurrence row. class_sessions.recurrence_id has ON DELETE
  -- SET NULL, so past sessions survive with recurrence_id = null.
  delete from public.class_recurrences where id = p_recurrence_id;

  return v_count;
end;
$$;

-- ============================================================================
-- 5. The emails leave on their own
-- ============================================================================
--
-- Modelled on dispatch_cover_notifications (0198), including its two
-- deliberate behaviours: a missing worker key logs why and sends nothing
-- rather than failing silently, and a per-gym post that throws leaves those
-- rows queued for the next sweep instead of aborting the run.
--
-- Every 15 minutes. A cancelled class is time-sensitive, but the table is
-- usually empty and the in-app notice — which members see immediately — has
-- already been written 'sent' by the enqueue.

create or replace function public.dispatch_class_change_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     record;
  v_gyms    integer := 0;
  v_posted  integer := 0;
  v_queued  integer;
  v_started timestamptz := clock_timestamp();
  v_key     text := public._worker_service_key();
begin
  select count(*)::int into v_queued
    from public.class_change_notifications
    where channel = 'email' and status = 'queued';

  if v_key is null then
    perform public._log_cron_run('dispatch-class-change-notifications',
      jsonb_build_object('skipped', 'no worker_service_key in vault',
                         'queued', v_queued));
    return 0;
  end if;

  for v_gym in
    select distinct gym_id from public.class_change_notifications
    where channel = 'email' and status = 'queued'
  loop
    v_gyms := v_gyms + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-class-change-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('gym_id', v_gym.gym_id)
      );
      v_posted := v_posted + 1;
    exception when others then
      null;
    end;
  end loop;

  perform public._log_cron_run('dispatch-class-change-notifications',
    jsonb_build_object('queued', v_queued, 'gyms', v_gyms, 'posted', v_posted,
                       'has_key', true),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_posted;
end;
$$;

revoke execute on function public.dispatch_class_change_notifications()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'dispatch-class-change-notifications',
  '*/15 * * * *',
  $$select public.dispatch_class_change_notifications();$$
);

commit;
