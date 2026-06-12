-- PAR-Q is now a booking prerequisite, not just an entry gate for
-- members. Anyone — coach, owner, member — must have a current PAR-Q
-- response on file before they can claim a slot in a class. Solves the
-- bootstrap deadlock left in 0037 (an owner can't be gated on PAR-Q at
-- entry because they have to enter to publish the questionnaire), and
-- gets every actual attendee screened.
--
-- The gate is inlined into _book_class_for rather than delegated to
-- current_parq_state() because:
--   (a) _book_class_for is called by the waitlist promotion trigger
--       with a profile != auth.uid(), and the trigger's auth context
--       doesn't satisfy current_parq_state's caller check.
--   (b) The logic is short and matches current_parq_state's: a gym
--       with no active questionnaire is unguarded (still the only way
--       for an owner to get rolling), and otherwise the booker must
--       have a response against the current version, completed within
--       the last 365 days.
--
-- Error message starts with 'PAR-Q required' so the client can match
-- on it and redirect to /parq.
--
-- Everything else in _book_class_for is unchanged from 0035.

begin;

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
  v_active_q     uuid;
  v_last_resp    public.parq_responses%rowtype;
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

  -- PAR-Q booking gate. No active questionnaire = no gate (the
  -- bootstrap path). With an active questionnaire, the booker must
  -- have a response against the current version, completed within the
  -- annual window.
  select id into v_active_q
    from public.parq_questionnaires
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_q is not null then
    select * into v_last_resp
      from public.parq_responses
      where gym_id = sess.gym_id and profile_id = p_profile_id
      order by completed_at desc
      limit 1;
    if v_last_resp.id is null
       or v_last_resp.questionnaire_id <> v_active_q
       or v_last_resp.completed_at < (now() - interval '365 days')
    then
      raise exception
        'PAR-Q required: complete the health screening before booking';
    end if;
  end if;

  -- Coach qualifications are enforced by claim_cover (0036); booking
  -- a class as a regular attendee is intentionally not gated on them.

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

revoke execute on function public._book_class_for(uuid, uuid)
  from public, anon, authenticated;

commit;
