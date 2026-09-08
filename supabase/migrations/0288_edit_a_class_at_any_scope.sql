-- 0288: change a class, at the scope you mean.
--
-- Staff could cancel a class from its own sheet and nothing else. Time,
-- length, capacity, coach, type, room and notes had no control anywhere on
-- the calendar: the only ways to change a class that already exists were
-- the talk bar (classes.edit / classes.move / classes.set_coach) and the
-- Bulk button, which is a relative shift over a From/To window. Neither is
-- where somebody looking at Wednesday's 06:00 goes to change Wednesday's
-- 06:00.
--
-- One RPC, the three scopes Cancel already taught: just this one, this and
-- all future, the whole series. Null means leave alone; the p_clear_*
-- flags exist because null cannot mean both "leave alone" and "empty this"
-- for a nullable column.
--
-- Reused rather than reinvented:
--   * _shift_class_times (0170) for the midnight-crossing refusal
--   * _clone_recurrence (0170, 0287) for the split
--   * _enqueue_classes_rescheduled (0169) for telling members
--   * set_session_coach's roster + qualification + clash rules (0224)
--   * reschedule_session's closure and already-run refusals (0224)
--
-- Decisions worth stating, because each has a plausible alternative:
--
-- The DAY, not the datetime, is the "from" boundary. cancel_recurrence_from
-- filters siblings on starts_at >= the anchor's exact time, so cancelling
-- the 17:30 leaves that morning's 06:00 running. An edit cannot do that: the
-- pattern is split on a date (ends_on / starts_on are dates), so a datetime
-- boundary would leave a session inside a window whose pattern claims values
-- it does not have. Both dialogs already say it in days — "sessions before
-- Wednesday 9 September" — so the words do not change, only Edit's filter.
--
-- A time change at series scope SHIFTS every time in the pattern, because
-- that is the only thing a pattern can say. A schedule at 06:00 and 17:30
-- edited to 06:30 becomes 06:30 and 18:00. That is bulk_edit_sessions'
-- behaviour and the chat action's, so it is the product's existing meaning
-- rather than a new one; the sheet says so in words before you save.
--
-- A partial application leaves the pattern alone and reports it. Same rule
-- and same reason as 0170: if one class was skipped because more members
-- are booked than the new capacity, no pattern describes the result, and
-- rewriting it would move the skipped class on the next walk.
--
-- Closures are checked for one class only, and that is not an oversight: a
-- closure covers whole days, and a series-scope time change stays inside
-- its own day, so a shift cannot move a class into or out of one.
--
-- The coach clash check is not gym-scoped, which is set_session_coach's own
-- behaviour and right — a person cannot be in two places at once, and since
-- 0283 one can coach at two gyms. It matters more here than it ever did
-- there: set_session_coach only asked about one class, so a series-wide
-- change is the first thing that can be told "they are busy" about a class
-- in a gym the operator cannot see. Hence a count rather than a raise: the
-- classes that could take the coach do, the ones that clash are reported.

begin;

-- 0227 tells members when their coach changes, because the coach is often
-- why they booked. Its helper is per session, keyed on session + coach,
-- which is right for set_session_coach (one class) and wrong here: a
-- series-wide change would post one notification per class, and the rule
-- for every class-change notification since 0165 is one digest per member
-- per change, never one per class. Same shape as
-- _enqueue_classes_rescheduled, same kind as 0227's, so it lands in the
-- Inbox's Classes tab and counts like the rest.
create or replace function public._enqueue_classes_coach_changed(
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
    p_gym_id, 'class_coach_changed', c.channel,
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
    c.channel || ':coachset:' || p_edit_key || ':' || a.profile_id
  from affected a
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0) / 2;
end;
$$;

revoke execute on function
  public._enqueue_classes_coach_changed(uuid, text, uuid[], text)
  from public, anon, authenticated;

create or replace function public.edit_session_scoped(
  p_session_id     uuid,
  p_scope          text,
  p_starts_at      timestamptz default null,
  p_duration       integer     default null,
  p_capacity       integer     default null,
  p_class_type_id  uuid        default null,
  p_coach_id       uuid        default null,
  p_clear_coach    boolean     default false,
  p_location       text        default null,
  p_clear_location boolean     default false,
  p_notes          text        default null,
  p_clear_notes    boolean     default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess        public.class_sessions;
  v_rec         public.class_recurrences;
  v_gym         uuid;
  v_tz          text;
  v_closure     public.gym_closures;
  v_role        public.gym_role;
  v_type_name   text;
  v_set_coach   boolean;
  v_coach       uuid;
  v_shift       integer := 0;
  v_new_times   text[];
  v_anchor_date date;
  v_anchor_from timestamptz;
  v_ids         uuid[];
  v_expected    integer;
  v_id          uuid;
  v_row         public.class_sessions;
  v_new_start   timestamptz;
  v_booked      integer;
  v_clash       integer;
  v_applied     boolean;
  v_ok_ids      uuid[] := '{}';
  v_moved       uuid[] := '{}';
  v_coached     uuid[] := '{}';
  v_coach_name  text;
  v_updated     integer := 0;
  v_overbooked  integer := 0;
  v_past        integer := 0;
  v_conflict    integer := 0;
  v_notified    integer := 0;
  v_schedule    text := 'none';
  v_win_id      uuid;
  v_key         text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_scope is null or p_scope not in ('one', 'from', 'series') then
    raise exception 'Say which classes to change';
  end if;

  select * into v_sess
    from public.class_sessions where id = p_session_id
    for update;
  if v_sess.id is null then
    raise exception 'That class is not there any more';
  end if;
  v_gym := v_sess.gym_id;

  if not public.effective_can(v_gym, 'can_edit_classes') then
    raise exception 'Not authorised';
  end if;
  -- can_bulk_edit_classes is blast radius over many classes, which is what
  -- 0169 wrote it for and exactly what the two series scopes are.
  if p_scope <> 'one'
     and not public.effective_can(v_gym, 'can_bulk_edit_classes') then
    raise exception 'Changing a whole series is not something you can do';
  end if;

  -- Editing a class that has already run rewrites history: its bookings and
  -- check-ins are a record of people who were there at a time that would
  -- stop being true.
  if v_sess.starts_at <= now() then
    raise exception 'That class has already run';
  end if;

  if p_scope <> 'one' then
    if v_sess.recurrence_id is null then
      raise exception 'That class is not part of a series';
    end if;
    select * into v_rec
      from public.class_recurrences where id = v_sess.recurrence_id
      for update;
    if v_rec.id is null then
      raise exception 'That series is not there any more';
    end if;
  end if;

  v_set_coach := p_clear_coach or p_coach_id is not null;

  if p_starts_at is null and p_duration is null and p_capacity is null
     and p_class_type_id is null and not v_set_coach
     and p_location is null and not p_clear_location
     and p_notes is null and not p_clear_notes then
    raise exception 'Nothing to change';
  end if;

  if p_duration is not null and (p_duration < 5 or p_duration > 480) then
    raise exception 'A class runs between 5 minutes and 8 hours';
  end if;
  if p_capacity is not null and p_capacity < 1 then
    raise exception 'Capacity must be at least 1';
  end if;

  -- A session's name is the class type's name (extend_recurrence takes
  -- ct.name), and the pattern has no name of its own, so the type is what
  -- carries a rename. Changing the type renames every class it applies to.
  if p_class_type_id is not null then
    select name into v_type_name
      from public.class_types
      where id = p_class_type_id and gym_id = v_gym and archived_at is null;
    if v_type_name is null then
      raise exception 'That class type is not available';
    end if;
  end if;

  if p_clear_coach then
    v_coach := null;
  elsif p_coach_id is not null then
    v_coach := p_coach_id;
    select role into v_role
      from public.gym_memberships
      where gym_id = v_gym and profile_id = p_coach_id and left_at is null;
    if v_role is null then
      raise exception 'They are not at this gym';
    end if;
    -- user_can_cover's rule, and its reason: admins do not coach.
    if v_role not in ('owner', 'coach') then
      raise exception 'Only an owner or a coach can be put on a class';
    end if;
    -- Against the type the class will HAVE, not the one it has now: a save
    -- that changed both could otherwise qualify against the old type.
    if exists (
      select 1 from public.coach_class_type_qualifications q
        where q.gym_id = v_gym
          and q.profile_id = p_coach_id
          and q.class_type_id = coalesce(p_class_type_id, v_sess.class_type_id)
          and q.qualified = false
    ) then
      raise exception 'They are not qualified to take that class';
    end if;
  end if;

  select timezone into v_tz from public.gyms where id = v_gym;
  if v_tz is null then
    raise exception 'Gym not found';
  end if;
  v_anchor_date := (v_sess.starts_at at time zone v_tz)::date;
  v_anchor_from := (v_anchor_date::text || ' 00:00')::timestamp at time zone v_tz;

  if p_starts_at is not null then
    if p_starts_at <= now() then
      raise exception 'Pick a time in the future';
    end if;
    if p_scope = 'one' then
      -- The suppression trigger is BEFORE INSERT only (0164), so moving a
      -- class into a live closure has to be refused here.
      select c.* into v_closure
        from public.gym_closures c
        where c.gym_id = v_gym
          and c.lifted_at is null
          and p_starts_at >= (c.starts_on::text || ' 00:00')::timestamp at time zone v_tz
          and p_starts_at <  ((c.ends_on + 1)::text || ' 00:00')::timestamp at time zone v_tz
        order by c.created_at
        limit 1;
      if v_closure.id is not null then
        raise exception 'The gym is closed from % to %',
          to_char(v_closure.starts_on, 'FMDD Mon'),
          to_char(v_closure.ends_on, 'FMDD Mon');
      end if;
    else
      if (p_starts_at at time zone v_tz)::date <> v_anchor_date then
        raise exception 'A series keeps its days. Move one class to another day with "Just this one".';
      end if;
      v_shift := (extract(epoch from (p_starts_at - v_sess.starts_at)) / 60)::integer;
      v_new_times := public._shift_class_times(v_rec.times, v_shift);
      if v_new_times is null then
        raise exception 'That would move a class past midnight. Move it by less, or edit the schedule itself.';
      end if;
    end if;
  end if;

  if p_scope = 'one' then
    v_ids := array[p_session_id];
  elsif p_scope = 'from' then
    select coalesce(array_agg(id), '{}') into v_ids
      from public.class_sessions
      where recurrence_id = v_rec.id
        and starts_at >= v_anchor_from
        and starts_at >  now();
  else
    select coalesce(array_agg(id), '{}') into v_ids
      from public.class_sessions
      where recurrence_id = v_rec.id
        and starts_at >  now();
  end if;
  v_expected := coalesce(array_length(v_ids, 1), 0);

  -- Shifting a run of classes by a constant moves each onto the slot its
  -- neighbour is vacating, so an unordered pass transiently violates
  -- class_sessions_recurrence_starts_unique. Walk away from the direction
  -- of travel, as 0170 does.
  for v_id in
    select id from public.class_sessions
      where id = any(v_ids)
      order by extract(epoch from starts_at)
               * (case when v_shift > 0 then -1 else 1 end)
  loop
    select * into v_row from public.class_sessions where id = v_id for update;

    if p_capacity is not null then
      select count(*)::int into v_booked
        from public.class_bookings where class_session_id = v_id;
      if p_capacity < v_booked then
        v_overbooked := v_overbooked + 1;
        continue;
      end if;
    end if;

    if p_starts_at is null then
      v_new_start := v_row.starts_at;
    elsif p_scope = 'one' then
      v_new_start := p_starts_at;
    else
      v_new_start := v_row.starts_at + (v_shift || ' minutes')::interval;
    end if;
    if v_new_start <= now() then
      v_past := v_past + 1;
      continue;
    end if;

    if v_set_coach and v_coach is not null then
      -- Siblings inside this edit are excluded: they are moving too, and a
      -- coach cannot clash with the same edit's own other classes on the
      -- strength of where they used to be.
      select count(*)::int into v_clash
        from public.class_sessions cs
        where cs.coach_id = v_coach
          and cs.id <> v_id
          and not (cs.id = any(v_ids))
          and cs.starts_at
              < v_new_start
                + (coalesce(p_duration, v_row.duration_minutes) || ' minutes')::interval
          and cs.starts_at + (cs.duration_minutes || ' minutes')::interval
              > v_new_start;
      if v_clash > 0 then
        v_conflict := v_conflict + 1;
        continue;
      end if;
    end if;

    v_applied := true;
    begin
      update public.class_sessions
        set starts_at        = v_new_start,
            duration_minutes = coalesce(p_duration, duration_minutes),
            capacity         = coalesce(p_capacity, capacity),
            class_type_id    = coalesce(p_class_type_id, class_type_id),
            name             = coalesce(v_type_name, name),
            coach_id         = case
                                 when p_clear_coach then null
                                 when p_coach_id is not null then p_coach_id
                                 else coach_id end,
            location         = case
                                 when p_clear_location then null
                                 when p_location is not null then p_location
                                 else location end,
            notes            = case
                                 when p_clear_notes then null
                                 when p_notes is not null then p_notes
                                 else notes end
        where id = v_id;
    exception when unique_violation then
      -- The slot it is moving onto already belongs to a sibling.
      v_conflict := v_conflict + 1;
      v_applied  := false;
    end;
    if not v_applied then
      continue;
    end if;

    v_updated := v_updated + 1;
    v_ok_ids  := v_ok_ids || v_id;
    if (p_starts_at is not null and v_new_start <> v_row.starts_at)
       or (p_duration is not null and p_duration <> v_row.duration_minutes) then
      v_moved := v_moved || v_id;
    end if;
    -- Only a coach who is genuinely new to this class: re-saving the sheet
    -- without touching the picker must not announce anything.
    if v_coach is not null and v_row.coach_id is distinct from v_coach then
      v_coached := v_coached || v_id;
    end if;
  end loop;

  -- ------------------------------------------------------------------
  -- The schedule behind them.
  -- ------------------------------------------------------------------
  if p_scope <> 'one' then
    if v_updated <> v_expected or v_expected = 0 then
      v_schedule := 'unchanged';
    elsif p_scope = 'series' or v_rec.starts_on >= v_anchor_date then
      update public.class_recurrences
        set times            = coalesce(v_new_times, times),
            duration_minutes = coalesce(p_duration, duration_minutes),
            capacity         = coalesce(p_capacity, capacity),
            class_type_id    = coalesce(p_class_type_id, class_type_id),
            coach_id         = case
                                 when p_clear_coach then null
                                 when p_coach_id is not null then p_coach_id
                                 else coach_id end,
            location         = case
                                 when p_clear_location then null
                                 when p_location is not null then p_location
                                 else location end,
            notes            = case
                                 when p_clear_notes then null
                                 when p_notes is not null then p_notes
                                 else notes end
        where id = v_rec.id;
      -- 0078 nulls the cursor on any pattern change, so newly added times
      -- backfill into days already walked. Here the times moved rather than
      -- multiplied and their sessions moved with them, so a re-walk from
      -- starts_on would only manufacture past occurrences at the new times.
      -- Restored in a second statement, which does not touch the pattern
      -- and so does not re-fire the trigger.
      update public.class_recurrences
        set materialized_until = v_rec.materialized_until
        where id = v_rec.id;
      v_schedule := 'updated';
    else
      -- Part of the schedule predates the anchor day, so it keeps the old
      -- pattern and a clone carries the edit from the anchor day onward.
      -- No third pattern is ever needed: this window runs to the end of the
      -- schedule's life by definition.
      v_win_id := public._clone_recurrence(
        v_rec.id, coalesce(v_new_times, v_rec.times),
        p_duration, p_capacity,
        v_anchor_date, v_rec.ends_on, v_rec.materialized_until);
      update public.class_recurrences
        set class_type_id = coalesce(p_class_type_id, class_type_id),
            coach_id      = case
                              when p_clear_coach then null
                              when p_coach_id is not null then p_coach_id
                              else coach_id end,
            location      = case
                              when p_clear_location then null
                              when p_location is not null then p_location
                              else location end,
            notes         = case
                              when p_clear_notes then null
                              when p_notes is not null then p_notes
                              else notes end
        where id = v_win_id;
      -- Same filter as the edit set, so pattern and sessions agree on who
      -- owns which dates. Past sessions keep the old parent, as 0170's
      -- split leaves them.
      update public.class_sessions
        set recurrence_id = v_win_id
        where recurrence_id = v_rec.id
          and starts_at >= v_anchor_from
          and starts_at >  now();
      -- Last, so the reparenting above still had the original to select.
      update public.class_recurrences
        set ends_on = v_anchor_date - 1
        where id = v_rec.id;
      v_schedule := 'split';
    end if;
  end if;

  -- Capacity, coach, room and notes are invisible to a member who already
  -- holds a place. A time or length change is not.
  if cardinality(v_moved) > 0 then
    -- Keyed on the resulting times, so a retry of the same save is silent
    -- while a genuine second change tells them again.
    select md5(v_gym::text || ':'
               || string_agg(id::text || '@' || starts_at::text, ',' order by id))
      into v_key
      from public.class_sessions where id = any(v_moved);
    v_notified := public._enqueue_classes_rescheduled(
      v_gym, v_key, v_moved,
      case when cardinality(v_moved) = 1
        then 'A class you have booked has changed time or length. Check your bookings for the new time.'
        else 'Some of the classes you have booked have changed time or length. Check your bookings for the new times.'
      end);
  end if;

  -- 0227's reason, digested: the coach is often why somebody booked, and
  -- finding out at the door is the worst way to learn it changed. Clearing
  -- a coach announces nothing — there is no one to name, and the class
  -- itself has not moved.
  if cardinality(v_coached) > 0 then
    select coalesce(nullif(trim(full_name), ''), 'a different coach')
      into v_coach_name from public.profiles where id = v_coach;
    select md5(v_gym::text || ':' || v_coach::text || ':'
               || string_agg(id::text, ',' order by id))
      into v_key
      from public.class_sessions where id = any(v_coached);
    v_notified := v_notified + public._enqueue_classes_coach_changed(
      v_gym, v_key, v_coached,
      case when cardinality(v_coached) = 1
        then v_coach_name || ' is taking a class you have booked.'
        else v_coach_name || ' is taking some of the classes you have booked.'
      end);
  end if;

  return jsonb_build_object(
    'updated',            v_updated,
    'skipped_overbooked', v_overbooked,
    'skipped_past',       v_past,
    'skipped_conflict',   v_conflict,
    'notified',           v_notified,
    'schedule',           v_schedule
  );
end;
$$;

revoke all on function public.edit_session_scoped(
  uuid, text, timestamptz, integer, integer, uuid, uuid, boolean,
  text, boolean, text, boolean) from public, anon;
grant execute on function public.edit_session_scoped(
  uuid, text, timestamptz, integer, integer, uuid, uuid, boolean,
  text, boolean, text, boolean) to authenticated;

commit;
