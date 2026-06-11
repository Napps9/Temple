-- Archiving a class type now actually cascades — without it, archiving
-- only flipped class_types.archived_at, which hid the class type from
-- pickers but left every other moving part running:
--
--   • extend_recurrence kept materialising new class_sessions
--   • book_class kept letting members book newly-materialised sessions
--   • class_programming kept accepting new rows for the archived type
--
-- The "wind down" model (option A): stop the production line, leave
-- existing future sessions in place so members who already booked
-- don't lose their slot, but make it impossible to add anything new.
--
--   1. extend_recurrence: skip recurrences whose class_type is archived
--   2. book_class: refuse on archived class types
--   3. class_programming insert/update trigger: refuses on archived
--      class types
--
-- A coach who wants the harsher "cancel everything future + refund"
-- behaviour can still loop through the calendar and cancel sessions
-- individually; we don't auto-refund because it's irreversible.
--
-- Restoring a class type reverses 1+2+3 immediately (no fixup needed
-- since none of the writes happened in the first place). The coach
-- then has to manually re-extend the recurrence's materialisation
-- horizon to start producing sessions again.

begin;

-- ============================================================================
-- 1. extend_recurrence: archived class types are a no-op
-- ============================================================================

create or replace function public.extend_recurrence(
  rec_id uuid,
  until_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec       public.class_recurrences;
  cur_date  date;
  cur_time  text;
  start_at  date;
  end_at    date;
  v_archived_at timestamptz;
begin
  select * into rec from public.class_recurrences where id = rec_id;
  if rec is null then
    raise exception 'Recurrence not found';
  end if;

  if not public.user_belongs_to(rec.gym_id) then
    raise exception 'Not authorised';
  end if;

  -- Honour the class type's archived state. The coach may still have
  -- the daily extend job running; we silently no-op so the job
  -- doesn't error out, but no new sessions get created.
  select archived_at into v_archived_at
    from public.class_types
    where id = rec.class_type_id;
  if v_archived_at is not null then
    return;
  end if;

  start_at := coalesce(rec.materialized_until + 1, rec.starts_on);
  end_at   := least(until_date, coalesce(rec.ends_on, until_date));
  if start_at > end_at then
    return;
  end if;

  cur_date := start_at;
  while cur_date <= end_at loop
    if extract(dow from cur_date)::int = ANY(rec.days_of_week) then
      foreach cur_time in array rec.times loop
        insert into public.class_sessions (
          gym_id, name, class_type_id, recurrence_id, starts_at,
          duration_minutes, capacity, notes, coach_id, created_by
        )
        select
          rec.gym_id,
          ct.name,
          rec.class_type_id,
          rec.id,
          ((cur_date::text || ' ' || cur_time)::timestamp) at time zone rec.tz,
          rec.duration_minutes,
          rec.capacity,
          rec.notes,
          rec.created_by,
          rec.created_by
        from public.class_types ct
        where ct.id = rec.class_type_id
        on conflict do nothing;
      end loop;
    end if;
    cur_date := cur_date + interval '1 day';
  end loop;

  update public.class_recurrences
    set materialized_until = end_at
    where id = rec.id;
end;
$$;

-- ============================================================================
-- 2. _book_class_for: refuse on archived class types
-- ============================================================================
-- public.book_class is unchanged — it's a thin wrapper that delegates
-- to _book_class_for, which is where the membership and capacity
-- checks live (refactor introduced in 0016 so the waitlist promotion
-- trigger could book on behalf of a different profile). The archived
-- check belongs alongside those checks.

create or replace function public._book_class_for(
  p_session_id uuid,
  p_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sess           public.class_sessions;
  current_count  int;
  v_booking_id   uuid;
  v_archived_at  timestamptz;
begin
  if p_profile_id is null then
    raise exception 'No profile to book for';
  end if;

  -- Lock the parent session row so concurrent bookings serialise.
  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

  -- Membership check uses an explicit join (not user_belongs_to /
  -- auth.uid()) because the trigger calls this with a profile other
  -- than the session caller, AND because user_belongs_to doesn't
  -- gate on left_at.
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = sess.gym_id
      and profile_id = p_profile_id
      and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  -- Block bookings into archived class types. Members who already had
  -- this class booked before the archive keep their booking — only
  -- new bookings are refused.
  select archived_at into v_archived_at
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;

  if current_count >= sess.capacity then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (sess.gym_id, p_session_id, p_profile_id)
  on conflict (class_session_id, profile_id) do nothing
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

-- Re-revoke after CREATE OR REPLACE (in case any grants got added
-- through a previous deployment cycle).
revoke execute on function public._book_class_for(uuid, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 3. class_programming: block writes against archived class types
-- ============================================================================

create or replace function public.class_programming_block_archived()
returns trigger
language plpgsql
as $$
declare
  v_archived_at timestamptz;
begin
  select archived_at into v_archived_at
    from public.class_types
    where id = new.class_type_id;
  if v_archived_at is not null then
    raise exception
      'Cannot programme an archived class type — restore the class type first';
  end if;
  return new;
end;
$$;

drop trigger if exists class_programming_no_archived on public.class_programming;
create trigger class_programming_no_archived
  before insert or update on public.class_programming
  for each row
  execute function public.class_programming_block_archived();

commit;
