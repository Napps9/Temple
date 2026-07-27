-- Bulk edits now rewrite the schedule, not just the sessions.
--
-- 0169's bulk_edit_sessions moved starts_at / duration / capacity on
-- individual class_sessions and left class_recurrences alone. The pattern
-- and the calendar then disagreed, and the pattern wins every time it is
-- next walked:
--
--   * Editing the schedule afterwards fires
--     _reset_recurrence_materialised_on_pattern_change (0078), which nulls
--     materialized_until. extend_recurrence re-walks from starts_on and
--     inserts the ORIGINAL slots alongside the moved ones — reproduced as
--     7 shifted classes plus 7 resurrected originals.
--   * The class-types editor's save path (class-types.tsx) deletes every
--     future session of the schedule and re-extends, so a shift silently
--     reverts.
--
-- A date-range edit is not always expressible as one pattern, so this
-- splits rather than blindly rewriting. For a recurrence R and window W:
--
--   R lies entirely inside W          -> rewrite R in place
--   R starts inside W but runs past it -> R becomes the W-scoped pattern,
--                                         a new one carries the original
--                                         pattern from the day after W
--   R starts before W                  -> R is truncated to the day before
--                                         W, a new W-scoped pattern is
--                                         created, and (if R ran past W) a
--                                         third carries the original on
--                                         afterwards
--
-- Sessions are reparented to whichever pattern now owns their dates, so
-- re-materialising is a no-op via class_sessions_recurrence_starts_unique
-- rather than a source of duplicates.
--
-- Two deliberate refusals, both because the alternative is a pattern that
-- lies:
--
--   * A partial selection (some classes unticked, or some skipped as
--     overbooked) leaves the pattern alone and is reported. "These three
--     Tuesdays but not that one" has no representation in a recurrence;
--     rewriting it would move the untouched class on the next walk.
--   * A shift that shunts any time past midnight is rejected outright,
--     before anything is applied. It would change which days_of_week the
--     pattern fires on, and a half-applied bulk edit is worse than a
--     refused one.

begin;

-- ============================================================================
-- 1. extend_recurrence: never materialise before starts_on
-- ============================================================================
--
-- The cursor has always been `coalesce(materialized_until + 1, starts_on)`,
-- which quietly assumes materialized_until is never behind starts_on. The
-- class-types editor breaks that assumption on every save — it stamps
-- materialized_until = today (class-types.tsx) — and the split below makes
-- it routine, because a window or post-window pattern legitimately starts
-- in the future. Left unclamped, such a schedule materialises backwards
-- over dates it does not own, which is how a shifted window ended up
-- holding both the new time and the old one.
--
-- Body is otherwise 0035 verbatim, archived-class-type guard included.

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

  select archived_at into v_archived_at
    from public.class_types
    where id = rec.class_type_id;
  if v_archived_at is not null then
    return;
  end if;

  start_at := greatest(
    coalesce(rec.materialized_until + 1, rec.starts_on), rec.starts_on);
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

grant execute on function public.extend_recurrence(uuid, date) to authenticated;

-- ============================================================================
-- 2. _shift_class_times
-- ============================================================================
--
-- Returns null when any time would leave the day. Postgres `time + interval`
-- wraps silently (23:30 + 60min = 00:30), which is exactly the case that has
-- to be caught rather than absorbed.

create or replace function public._shift_class_times(
  p_times text[],
  p_shift integer
) returns text[]
language plpgsql
immutable
as $$
declare
  v_out text[] := '{}';
  v_t   text;
  v_m   integer;
begin
  if p_shift is null or p_shift = 0 then
    return p_times;
  end if;
  foreach v_t in array p_times loop
    v_m := split_part(v_t, ':', 1)::int * 60 + split_part(v_t, ':', 2)::int + p_shift;
    if v_m < 0 or v_m >= 1440 then
      return null;
    end if;
    v_out := v_out
      || (lpad((v_m / 60)::text, 2, '0') || ':' || lpad((v_m % 60)::text, 2, '0'));
  end loop;
  return v_out;
end;
$$;

grant execute on function public._shift_class_times(text[], integer) to authenticated;

-- ============================================================================
-- 3. _clone_recurrence
-- ============================================================================
--
-- Every split makes a copy differing only in pattern and date span. Kept
-- as a helper because the three call sites below would otherwise repeat a
-- fifteen-column insert, and a column added to class_recurrences later
-- would have to be remembered in all of them.

create or replace function public._clone_recurrence(
  p_source_id          uuid,
  p_times              text[],
  p_duration_minutes   integer,
  p_capacity           integer,
  p_starts_on          date,
  p_ends_on            date,
  p_materialized_until date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     notes, starts_on, ends_on, tz, materialized_until, created_by, location)
  select
    r.gym_id, r.class_type_id, r.days_of_week, p_times,
    coalesce(p_duration_minutes, r.duration_minutes),
    coalesce(p_capacity, r.capacity),
    r.notes, p_starts_on, p_ends_on, r.tz, p_materialized_until,
    r.created_by, r.location
  from public.class_recurrences r
  where r.id = p_source_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function
  public._clone_recurrence(uuid, text[], integer, integer, date, date, date)
  from public, anon, authenticated;

-- ============================================================================
-- 4. bulk_edit_sessions
-- ============================================================================
--
-- Same signature and return type as 0169, so CREATE OR REPLACE is safe.
-- The result gains recurrences_updated / recurrences_split /
-- recurrences_unchanged; the existing keys keep their meaning.

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
  v_rec           public.class_recurrences;
  v_booked        integer;
  v_new_start     timestamptz;
  v_updated       integer := 0;
  v_overbooked    integer := 0;
  v_past          integer := 0;
  v_conflict      integer := 0;
  v_applied       boolean;
  v_moved         uuid[]  := '{}';
  v_applied_ids   uuid[]  := '{}';
  v_rec_ids       uuid[]  := '{}';
  v_rec_before    integer[] := '{}';
  v_edit_key      text;
  v_notified      integer := 0;
  v_rec_updated   integer := 0;
  v_rec_split     integer := 0;
  v_rec_unchanged integer := 0;
  v_new_times     text[];
  v_win_id        uuid;
  v_post_id       uuid;
  v_has_before    boolean;
  v_has_after     boolean;
  v_applied_count integer;
  v_i             integer;
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

  -- Which schedules the window touches, and how many future classes each
  -- has inside it. Captured BEFORE anything moves: once starts_at changes,
  -- "how many were in the window" is no longer answerable, and it is the
  -- number that decides whether the pattern may be rewritten.
  select array_agg(rid), array_agg(cnt)
    into v_rec_ids, v_rec_before
  from (
    select cs.recurrence_id as rid, count(*)::int as cnt
    from public.class_sessions cs
    where cs.gym_id       = p_gym_id
      and cs.recurrence_id is not null
      and cs.starts_at    >  now()
      and cs.starts_at    >= v_window_start
      and cs.starts_at    <  v_window_end
    group by cs.recurrence_id
  ) s;
  v_rec_ids    := coalesce(v_rec_ids, '{}');
  v_rec_before := coalesce(v_rec_before, '{}');

  -- Reject a midnight-crossing shift before touching anything. Checked
  -- against every schedule in the window, not only the fully-selected
  -- ones, so the answer does not depend on what happens to be ticked.
  if p_shift_minutes is not null and p_shift_minutes <> 0 then
    for v_rec in
      select * from public.class_recurrences where id = any(v_rec_ids)
    loop
      if public._shift_class_times(v_rec.times, p_shift_minutes) is null then
        raise exception
          'Shifting by % minutes would move a class past midnight. Move it by a smaller amount, or edit that schedule directly.',
          p_shift_minutes using errcode = 'P0001';
      end if;
    end loop;
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

    v_updated     := v_updated + 1;
    v_applied_ids := v_applied_ids || v_sess.id;
    if p_shift_minutes is not null or p_duration_minutes is not null then
      v_moved := v_moved || v_sess.id;
    end if;
  end loop;

  -- ------------------------------------------------------------------
  -- Reconcile the schedules behind the classes we just moved.
  -- ------------------------------------------------------------------
  for v_i in 1 .. coalesce(array_length(v_rec_ids, 1), 0) loop
    select * into v_rec from public.class_recurrences where id = v_rec_ids[v_i];
    if v_rec.id is null then
      continue;
    end if;

    select count(*)::int into v_applied_count
      from public.class_sessions
      where id = any(v_applied_ids) and recurrence_id = v_rec.id;

    -- Anything less than all of them and the pattern cannot describe the
    -- result, so it is left alone and reported.
    if v_applied_count <> v_rec_before[v_i] then
      v_rec_unchanged := v_rec_unchanged + 1;
      continue;
    end if;

    v_new_times  := public._shift_class_times(v_rec.times, p_shift_minutes);
    v_has_before := v_rec.starts_on < p_start;
    v_has_after  := v_rec.ends_on is null or v_rec.ends_on > p_end;

    if not v_has_before and not v_has_after then
      -- The window covers the schedule's whole life: rewrite it in place.
      update public.class_recurrences
        set times            = v_new_times,
            duration_minutes = coalesce(p_duration_minutes, duration_minutes),
            capacity         = coalesce(p_capacity, capacity)
        where id = v_rec.id;
      -- The 0078 trigger nulls the cursor on any pattern change so newly
      -- added times backfill into already-materialised days. Here the times
      -- moved rather than multiplied and the sessions moved with them, so a
      -- re-walk from starts_on would only manufacture past occurrences at
      -- the new times. Restore the cursor in a second statement, which does
      -- not touch the pattern and so does not re-fire the trigger.
      update public.class_recurrences
        set materialized_until = v_rec.materialized_until
        where id = v_rec.id;
      v_rec_updated := v_rec_updated + 1;
      continue;
    end if;

    if v_has_before then
      v_win_id := public._clone_recurrence(
        v_rec.id, v_new_times, p_duration_minutes, p_capacity,
        p_start, p_end, p_end);
      update public.class_sessions
        set recurrence_id = v_win_id
        where recurrence_id = v_rec.id
          and starts_at >  now()
          and starts_at >= v_window_start
          and starts_at <  v_window_end;
    else
      -- Nothing of the schedule predates the window, so it can BE the
      -- window pattern; only its tail needs carving off.
      update public.class_recurrences
        set times            = v_new_times,
            duration_minutes = coalesce(p_duration_minutes, duration_minutes),
            capacity         = coalesce(p_capacity, capacity),
            ends_on          = p_end
        where id = v_rec.id;
      update public.class_recurrences
        set materialized_until = p_end where id = v_rec.id;
    end if;

    if v_has_after then
      v_post_id := public._clone_recurrence(
        v_rec.id, v_rec.times, v_rec.duration_minutes, v_rec.capacity,
        p_end + 1, v_rec.ends_on,
        case when v_rec.materialized_until > p_end
             then v_rec.materialized_until end);
      update public.class_sessions
        set recurrence_id = v_post_id
        where recurrence_id = v_rec.id
          and starts_at >= v_window_end;
    end if;

    if v_has_before then
      -- Last, so the reparenting above still had R to select from.
      update public.class_recurrences
        set ends_on = p_start - 1 where id = v_rec.id;
    end if;

    v_rec_split := v_rec_split + 1;
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
    'updated',              v_updated,
    'skipped_overbooked',   v_overbooked,
    'skipped_past',         v_past,
    'skipped_conflict',     v_conflict,
    'notified',             v_notified,
    'recurrences_updated',  v_rec_updated,
    'recurrences_split',    v_rec_split,
    'recurrences_unchanged', v_rec_unchanged
  );
end;
$$;

grant execute on function
  public.bulk_edit_sessions(uuid, date, date, uuid[], integer, integer, integer)
  to authenticated;

commit;
