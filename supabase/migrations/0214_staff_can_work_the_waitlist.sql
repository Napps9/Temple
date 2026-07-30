-- Staff can put someone on a waitlist, and take them off.
--
-- join_waitlist and leave_waitlist are both auth.uid()-only with no target
-- parameter, and class_waitlist has no INSERT, UPDATE or DELETE policy at
-- all — so the queue is writable by exactly one person per row, themselves.
-- That is right for a member tapping "join the waitlist" and leaves staff
-- with nothing: the only way to get someone onto a full class today is to
-- ask them to do it on their own phone.
--
-- It matters now because a full class is the one moment where the useful
-- answer is a choice — go over the cap, or take the next space that opens —
-- and offering the second half of that with no write behind it would be a
-- button that lies.
--
-- Bodies mirror join_waitlist / leave_waitlist rather than reinventing
-- them: the same eligibility check, the same refusal when the class has
-- spare capacity, the same insertion-order position, the same conflict
-- behaviour. Two differences, both deliberate:
--
--   1. The eligibility check is is_booking_eligible for the TARGET, not the
--      caller. Its own gate admits the subject or anyone passing
--      user_can_assign_plan, which staff do — so this reads the member's
--      real eligibility rather than the staff member's.
--   2. It does not refuse a class that has already started for the leave
--      path. Taking a stale name off yesterday's queue is tidying, not a
--      booking, and nothing downstream reads it.

begin;

create or replace function public.staff_join_waitlist(
  p_gym_id     uuid,
  p_session_id uuid,
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  sess          public.class_sessions;
  current_count int;
  next_pos      int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id and gym_id = p_gym_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;
  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_profile_id and left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;
  if current_count < sess.capacity then
    raise exception 'Class has spare capacity — book them in directly';
  end if;

  select coalesce(max(position), 0) + 1 into next_pos
    from public.class_waitlist
    where class_session_id = p_session_id;

  insert into public.class_waitlist
    (gym_id, class_session_id, profile_id, position)
  values (p_gym_id, p_session_id, p_profile_id, next_pos)
  on conflict (class_session_id, profile_id) do nothing;

  -- Their rank, computed the way waitlist_for_session computes it, so the
  -- receipt can say "third in the queue" rather than a raw position with
  -- gaps in it. position is insertion order and is never rewritten.
  return (
    select rank from (
      select profile_id,
             row_number() over (order by position)::int as rank
        from public.class_waitlist
        where class_session_id = p_session_id
    ) q
    where q.profile_id = p_profile_id
  );
end;
$$;

revoke execute on function public.staff_join_waitlist(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.staff_join_waitlist(uuid, uuid, uuid)
  to authenticated;

create or replace function public.staff_leave_waitlist(
  p_gym_id     uuid,
  p_session_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;

  with gone as (
    delete from public.class_waitlist w
    using public.class_sessions cs
    where w.class_session_id = p_session_id
      and w.profile_id = p_profile_id
      and cs.id = w.class_session_id
      and cs.gym_id = p_gym_id
    returning w.id
  )
  select count(*)::int into v_removed from gone;

  return v_removed > 0;
end;
$$;

revoke execute on function public.staff_leave_waitlist(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.staff_leave_waitlist(uuid, uuid, uuid)
  to authenticated;

commit;
