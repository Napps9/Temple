-- Tell members when their class comes back, and group the reopen picker
-- by day.
--
-- Closing tells the members who lost a booking (0169). Reopening told
-- nobody, and it is the half that needs an action from them: the credit
-- was returned when the gym shut, so a class coming back means they have
-- to book it again. Nothing happens if they never find out.
--
-- The reason it could not be done in 0169 is that the closure notification
-- stores rendered text — the sessions it describes are deleted by send
-- time, so there is no structured record of who had booked what. This adds
-- one: close_gym_dates snapshots the cancelled bookings as
-- (recurrence_id, starts_at) pairs, which is exactly the key
-- preview_closure_reopen speaks, so a restored slot maps straight back to
-- the people who lost it.
--
-- Recorded against the pattern slot rather than the session id on purpose:
-- the session is about to be deleted, and the one that comes back is a
-- different row. A one-off (recurrence_id null) can never be restored, so
-- it never matches — it is still recorded, because "who lost what" is
-- worth having whole.
--
-- Sections:
--   1. closure_cancelled_bookings   — the record
--   2. close_gym_dates              — write it
--   3. classes_reopened             — new notification kind
--   4. preview_closure_reopen       — expose the gym-local day
--   5. reopen_closure               — notify whoever lost a restored class

begin;

-- ============================================================================
-- 1. closure_cancelled_bookings
-- ============================================================================

create table public.closure_cancelled_bookings (
  id            uuid primary key default gen_random_uuid(),
  closure_id    uuid not null references public.gym_closures(id) on delete cascade,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  recurrence_id uuid references public.class_recurrences(id) on delete set null,
  starts_at     timestamptz not null,
  class_type_id uuid references public.class_types(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- The reopen lookup: one closure, matched by pattern slot.
create index closure_cancelled_bookings_slot_idx
  on public.closure_cancelled_bookings(closure_id, recurrence_id, starts_at);

alter table public.closure_cancelled_bookings enable row level security;

-- A member can see what they lost; staff who can close the gym can see the
-- lot. No client writes — close_gym_dates owns them.
create policy closure_cancelled_bookings_select
  on public.closure_cancelled_bookings
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_bulk_edit_classes')
  );

-- ============================================================================
-- 2. close_gym_dates records the bookings it is about to delete
-- ============================================================================
--
-- Same signature and body as 0169 apart from the snapshot, which sits
-- alongside the notification enqueue for the same reason: both read
-- class_bookings, and _cancel_session_internal is about to empty it.

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

  v_window_start := (p_start::text || ' 00:00')::timestamp at time zone v_tz;
  v_window_end   := ((p_end + 1)::text || ' 00:00')::timestamp at time zone v_tz;
  if v_window_end <= now() then
    raise exception 'That date range is in the past';
  end if;

  perform public.extend_gym_recurrences(p_gym_id, p_end);

  insert into public.gym_closures
    (gym_id, starts_on, ends_on, reason, created_by)
  values
    (p_gym_id, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''), v_uid)
  returning id into v_closure_id;

  v_notified := public._enqueue_gym_closed(
    v_closure_id, v_window_start, v_window_end, p_exclude_session_ids);

  insert into public.closure_cancelled_bookings
    (closure_id, gym_id, profile_id, recurrence_id, starts_at, class_type_id)
  select
    v_closure_id, p_gym_id, b.profile_id, cs.recurrence_id, cs.starts_at,
    cs.class_type_id
  from public.class_bookings b
  join public.class_sessions cs on cs.id = b.class_session_id
  where cs.gym_id    = p_gym_id
    and cs.starts_at >  now()
    and cs.starts_at >= v_window_start
    and cs.starts_at <  v_window_end
    and not (cs.id = any(coalesce(p_exclude_session_ids, '{}'::uuid[])));

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
-- 3. classes_reopened
-- ============================================================================

alter table public.class_change_notifications
  drop constraint class_change_notifications_kind_check;

alter table public.class_change_notifications
  add constraint class_change_notifications_kind_check
  check (kind in ('gym_closed', 'classes_rescheduled', 'classes_reopened'));

-- One digest per member per reopen, not one per class. The key carries a
-- digest of the restored slots, so a second reopen that brings back
-- different classes tells them again while a retry of the same one does
-- not.
create or replace function public._enqueue_classes_reopened(
  p_closure_id uuid,
  p_slots      jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.gym_closures;
  v_key     text;
  v_count   integer;
begin
  select * into v_closure from public.gym_closures where id = p_closure_id;
  if v_closure.id is null or jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) = 0 then
    return 0;
  end if;

  v_key := md5(p_closure_id::text || ':' || p_slots::text);

  with slot as (
    select (s ->> 'recurrence_id')::uuid    as recurrence_id,
           (s ->> 'starts_at')::timestamptz as starts_at
    from jsonb_array_elements(p_slots) s
  ),
  affected as (
    select b.profile_id, count(*)::int as class_count, u.email
    from public.closure_cancelled_bookings b
    join slot on slot.recurrence_id is not distinct from b.recurrence_id
             and slot.starts_at = b.starts_at
    join auth.users u on u.id = b.profile_id
    where b.closure_id = p_closure_id
    group by b.profile_id, u.email
  )
  insert into public.class_change_notifications
    (gym_id, closure_id, kind, channel, recipient, recipient_profile_id,
     body, status, sent_at, error, idempotency_key)
  select
    v_closure.gym_id, p_closure_id, 'classes_reopened', c.channel,
    case when c.channel = 'in_app' then a.profile_id::text else a.email end,
    a.profile_id,
    a.class_count
      || case when a.class_count = 1 then ' class you had booked is'
              else ' classes you had booked are' end
      || ' back on the timetable. Your credits were returned when the gym '
      || 'closed, so you will need to book again to keep your place.',
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
    c.channel || ':reopened:' || p_closure_id || ':' || v_key || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0) / 2;
end;
$$;

revoke execute on function public._enqueue_classes_reopened(uuid, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- 4. preview_closure_reopen gains the gym-local day
-- ============================================================================
--
-- The picker groups by day so a fortnight of a busy timetable is tickable
-- a day at a time. The grouping key has to be the day the gym means, not
-- the day the viewer's browser renders — those differ for anyone signed in
-- from another timezone. The walk already has it; this returns it rather
-- than making the client re-derive it.
--
-- RETURNS TABLE gains a column, and CREATE OR REPLACE cannot change a
-- function's return shape (0043).

drop function if exists public.preview_closure_reopen(uuid);

create function public.preview_closure_reopen(p_closure_id uuid)
returns table (
  recurrence_id    uuid,
  starts_at        timestamptz,
  local_date       date,
  class_type_name  text,
  duration_minutes integer,
  capacity         integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    s.sa,
    d::date,
    ct.name,
    r.duration_minutes,
    r.capacity
  from public.gym_closures c
  join public.class_recurrences r on r.gym_id = c.gym_id
  join public.class_types ct
    on ct.id = r.class_type_id and ct.archived_at is null
  cross join lateral generate_series(
    greatest(c.starts_on, r.starts_on)::timestamp,
    least(c.ends_on, coalesce(r.ends_on, c.ends_on))::timestamp,
    interval '1 day') d
  cross join lateral unnest(r.times) t
  cross join lateral (
    select ((d::date::text || ' ' || t)::timestamp at time zone r.tz) as sa
  ) s
  where c.id = p_closure_id
    and c.lifted_at is null
    and public.effective_can(c.gym_id, 'can_bulk_edit_classes')
    and extract(dow from d)::int = any(r.days_of_week)
    and s.sa > now()
    and not exists (
      select 1 from public.class_sessions cs
      where cs.recurrence_id = r.id and cs.starts_at = s.sa
    )
  order by 2, 4;
$$;

grant execute on function public.preview_closure_reopen(uuid) to authenticated;

-- ============================================================================
-- 5. reopen_closure notifies whoever lost a restored class
-- ============================================================================
--
-- Both branches now derive what came back the same way: snapshot the
-- window's session ids first, diff afterwards. That is simpler than the
-- per-recurrence before/after counting it replaces, and it is the only way
-- to get the SLOTS (not just a count) out of the lift branch, where
-- extend_recurrence does the inserting.

create or replace function public.reopen_closure(
  p_closure_id uuid,
  p_exclude    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure   public.gym_closures;
  v_exclude   jsonb := coalesce(p_exclude, '[]'::jsonb);
  v_tz        text;
  v_ws        timestamptz;
  v_we        timestamptz;
  v_before    uuid[];
  v_slots     jsonb;
  v_rec       record;
  v_lifted    boolean := false;
  v_restored  integer := 0;
  v_notified  integer := 0;
begin
  select * into v_closure from public.gym_closures where id = p_closure_id;
  if v_closure.id is null then
    raise exception 'Closure not found';
  end if;
  if not public.effective_can(v_closure.gym_id, 'can_bulk_edit_classes') then
    raise exception 'Not authorised';
  end if;
  if v_closure.lifted_at is not null then
    return jsonb_build_object('restored', 0, 'lifted', false, 'notified', 0);
  end if;
  if jsonb_typeof(v_exclude) <> 'array' then
    raise exception 'Excluded classes must be a list';
  end if;

  select timezone into v_tz from public.gyms where id = v_closure.gym_id;
  v_ws := (v_closure.starts_on::text || ' 00:00')::timestamp at time zone v_tz;
  v_we := ((v_closure.ends_on + 1)::text || ' 00:00')::timestamp at time zone v_tz;

  select coalesce(array_agg(id), '{}') into v_before
  from public.class_sessions
  where gym_id = v_closure.gym_id and starts_at >= v_ws and starts_at < v_we;

  -- Nothing held back: the closure has no remaining purpose, so end it and
  -- re-materialise normally. Rewinding each cursor over the window and
  -- re-extending is what puts the classes back;
  -- class_sessions_recurrence_starts_unique plus extend_recurrence's own
  -- `on conflict do nothing` make re-walking already-materialised days a
  -- no-op, so only the deleted occurrences are re-created.
  --
  -- Bookings are NOT restored, whichever branch runs — the members were
  -- refunded and have to book again. That is exactly why they are told.
  if jsonb_array_length(v_exclude) = 0 then
    update public.gym_closures
      set lifted_at = now(), lifted_by = auth.uid()
      where id = p_closure_id;
    v_lifted := true;

    for v_rec in
      select id, materialized_until
      from public.class_recurrences
      where gym_id = v_closure.gym_id
        and materialized_until >= v_closure.starts_on
    loop
      update public.class_recurrences
        set materialized_until = (v_closure.starts_on - 1)
        where id = v_rec.id;
      perform public.extend_recurrence(v_rec.id, v_rec.materialized_until);
    end loop;
  else
    -- Something is still being held back, so the closure stays live and
    -- only the ticked slots are written. The flag is what lets these past
    -- the suppression trigger; everything else in the window stays shut,
    -- including classes created later.
    perform set_config('temple.restoring_closed_class', 'on', true);

    insert into public.class_sessions
      (gym_id, name, class_type_id, recurrence_id, starts_at,
       duration_minutes, capacity, notes, coach_id, created_by)
    select
      r.gym_id, p.class_type_name, r.class_type_id, p.recurrence_id,
      p.starts_at, p.duration_minutes, p.capacity, r.notes,
      r.created_by, r.created_by
    from public.preview_closure_reopen(p_closure_id) p
    join public.class_recurrences r on r.id = p.recurrence_id
    where not exists (
      select 1 from jsonb_array_elements(v_exclude) e
      where (e ->> 'recurrence_id')::uuid    = p.recurrence_id
        and (e ->> 'starts_at')::timestamptz = p.starts_at
    )
    on conflict do nothing;

    perform set_config('temple.restoring_closed_class', 'off', true);
  end if;

  select
    count(*)::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'recurrence_id', recurrence_id, 'starts_at', starts_at
    ) order by starts_at), '[]'::jsonb)
    into v_restored, v_slots
  from public.class_sessions
  where gym_id = v_closure.gym_id
    and starts_at >= v_ws and starts_at < v_we
    and not (id = any(v_before));

  v_notified := public._enqueue_classes_reopened(p_closure_id, v_slots);

  return jsonb_build_object(
    'restored', v_restored,
    'lifted',   v_lifted,
    'notified', v_notified
  );
end;
$$;

grant execute on function public.reopen_closure(uuid, jsonb) to authenticated;

commit;
