-- One class can move, and one class can change coach
--
-- Two things the calendar shows and nothing could change.
--
-- **Moving one class.** bulk_edit_sessions (0169/0170) is the only write
-- that touches a session's time, and it is a *relative* shift over a date
-- range: `p_shift_minutes`, refused outright if it would push anything
-- past midnight (0170's _shift_class_times). So "move Tuesday's 6pm to
-- Thursday at 7" has no expression at all, and even "make it 6:30" means
-- selecting a range and shifting it. The client cannot do it either —
-- 0195 revoked UPDATE on class_sessions from authenticated, deliberately,
-- because the RLS policy read a raw-role helper and routed around every
-- guard that lives in the definer function.
--
-- **Changing the coach.** class_sessions.coach_id has exactly one writer
-- in the whole schema: claim_cover, which sets it to auth.uid(). A coach
-- can volunteer for a class; nobody can be given one. "Put Jo on
-- Saturday's 9am" has never been sayable, in the app or in SQL.
--
-- What this deliberately does not do, in both cases:
--
--   * **It does not touch class_recurrences.** 0170 refuses to rewrite a
--     pattern from a partial selection, because "these three Tuesdays but
--     not that one" has no representation in a recurrence and rewriting
--     it would move the untouched class on the next walk. One session is
--     the most partial selection there is. The consequence is real and
--     belongs on the card, not hidden here: the schedule still says the
--     original slot, so editing the schedule later re-materialises it.
--   * **It does not tell the members about a coach change.** Not an
--     oversight — class_change_notifications.kind has no coach-change
--     value, and the existing reassignment path (claim_cover) tells the
--     coach who asked and nobody else. Adding member mail here and not
--     there would make cover and assignment behave differently for the
--     same visible event. Named in docs/roadmap.md as one gap across both
--     paths rather than half-fixed in one.
--
-- Both gate on effective_can(gym_id, 'can_edit_classes') — the key the
-- staff calendar reads for its own edit affordances, and the one 0219
-- moved the programming surfaces onto. can_bulk_edit_classes stays what
-- it was written for in 0169: blast radius over a range, an owner/admin
-- decision. Moving one class is not that.

-- ---------------------------------------------------------------------------
-- 1. Move one class
-- ---------------------------------------------------------------------------
--
-- Absolute, not relative: the caller says when it starts, because that is
-- what somebody says out loud. Duration is optional and unchanged when
-- omitted.

create or replace function public.reschedule_session(
  p_session_id uuid,
  p_starts_at  timestamptz,
  p_duration   integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.class_sessions;
  v_tz      text;
  v_closure public.gym_closures;
  v_booked  integer;
  v_key     text;
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

  if p_starts_at is null then
    raise exception 'Say when it starts';
  end if;
  if p_duration is not null and (p_duration < 5 or p_duration > 480) then
    raise exception 'A class runs between 5 minutes and 8 hours';
  end if;
  -- Moving a class that has already run rewrites history: the bookings
  -- and check-ins on it are a record of people who were there at a time
  -- that would stop being true.
  if v_session.starts_at <= now() then
    raise exception 'That class has already run';
  end if;
  if p_starts_at <= now() then
    raise exception 'Pick a time in the future';
  end if;

  -- The suppression trigger is BEFORE INSERT only (0164 explains why it
  -- must not fire on update), so moving a class into a live closure is a
  -- hole that has to be closed here rather than by the trigger.
  select timezone into v_tz from public.gyms where id = v_session.gym_id;
  select c.* into v_closure
    from public.gym_closures c
    where c.gym_id = v_session.gym_id
      and c.lifted_at is null
      and v_tz is not null
      and p_starts_at >= (c.starts_on::text || ' 00:00')::timestamp at time zone v_tz
      and p_starts_at <  ((c.ends_on + 1)::text || ' 00:00')::timestamp at time zone v_tz
    order by c.created_at
    limit 1;
  if v_closure.id is not null then
    raise exception 'The gym is closed from % to %',
      to_char(v_closure.starts_on, 'FMDD Mon'),
      to_char(v_closure.ends_on, 'FMDD Mon');
  end if;

  begin
    update public.class_sessions
      set starts_at        = p_starts_at,
          duration_minutes = coalesce(p_duration, duration_minutes)
      where id = p_session_id;
  exception when unique_violation then
    -- class_sessions_recurrence_starts_unique: the slot it is moving onto
    -- already belongs to a sibling of the same recurrence.
    raise exception 'There is already a class of that series at that time';
  end;

  -- Only if somebody is booked, and keyed on the resulting time so a
  -- double-tap does not mail twice while a genuine second move does.
  select count(*) into v_booked
    from public.class_bookings where class_session_id = p_session_id;
  if v_booked > 0 then
    v_key := md5(p_session_id::text || ':' || p_starts_at::text);
    perform public._enqueue_classes_rescheduled(
      v_session.gym_id, v_key, array[p_session_id],
      'A class you have booked has changed time.');
  end if;
end;
$$;

grant execute on function
  public.reschedule_session(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Put a different coach on it
-- ---------------------------------------------------------------------------
--
-- The checks are claim_cover's, because they are the ones that path
-- already learned the hard way: a coach cannot be in two places at once,
-- and a coach who is not qualified for a class type must not be put in
-- front of it. The difference is who decides — claim_cover is a
-- volunteer taking a class, this is somebody being given one, so it is
-- gated on editing classes rather than on covering them.

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
end;
$$;

grant execute on function public.set_session_coach(uuid, uuid) to authenticated;
