-- Phase 3 Tier 6: waitlist mechanic.
--
-- The promotion trigger does not impersonate — it calls an explicit
-- profile-parameterised helper (`_book_class_for`) with the
-- waitlister's id passed as data. No request.jwt.claim.sub mutation.
--
-- Displayed rank is computed at read time inside SECURITY DEFINER
-- functions that run over the full session waitlist regardless of RLS
-- visibility. A security_invoker view would have ranked over the
-- caller's RLS-filtered scan (member sees only their own row → window
-- returns 1 → lie). Rule worth pinning to the wall: window-function
-- rank under RLS goes through a DEFINER function, not a view.

-- ============================================================================
-- 1. book_class refactor: extract a profile-parameterised helper
-- ============================================================================
-- The public book_class wrapper preserves the existing signature
-- (session_id uuid) so the client RPC call shape is unchanged.

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
  -- than the session caller.
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = sess.gym_id and profile_id = p_profile_id and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
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
-- Lock the no-caller-auth helper out of the PostgREST surface: SECURITY
-- DEFINER callers (the public book_class wrapper, the promote_from_waitlist
-- trigger) run as the function owner and so can still invoke this. A
-- direct grant to authenticated would let any signed-in user book on
-- behalf of any other profile by passing their uuid — exactly what the
-- _book_class_for split was designed to prevent.
revoke execute on function public._book_class_for(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.book_class(session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  perform public._book_class_for(session_id, uid);
end;
$$;
grant execute on function public.book_class(uuid) to authenticated;

-- ============================================================================
-- 2. class_waitlist table
-- ============================================================================

create table public.class_waitlist (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  class_session_id  uuid not null references public.class_sessions(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  position          int not null,
  created_at        timestamptz not null default now(),
  unique (class_session_id, profile_id),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

-- position is insertion order, NEVER updated. Both leaves and
-- promotions just delete; the visible "#N" is computed at read time
-- (so we don't care about gaps). No unique on (session, position).

create index class_waitlist_session_position_idx
  on public.class_waitlist(class_session_id, position);

alter table public.class_waitlist enable row level security;

create policy class_waitlist_self_or_staff_select on public.class_waitlist
  for select using (
    profile_id = auth.uid()
    or public.user_can_access_staff_area(gym_id)
  );

-- INSERT / UPDATE / DELETE go through RPCs; no policies = denied.

-- ============================================================================
-- 3. Rank functions — DEFINER so the window sees the full queue
-- ============================================================================
-- Without these, a security_invoker view would rank a member's
-- RLS-filtered scan (just their own row) → always returns 1 → lies.

create or replace function public.my_waitlist_rank(p_session_id uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select rank from (
    select profile_id,
           row_number() over (order by position) as rank
    from public.class_waitlist
    where class_session_id = p_session_id
  ) ranked
  where profile_id = auth.uid();
$$;
grant execute on function public.my_waitlist_rank(uuid) to authenticated;

create or replace function public.waitlist_for_session(p_session_id uuid)
returns table (rank int, profile_id uuid, joined_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  select gym_id into v_gym_id
    from public.class_sessions
    where id = p_session_id;
  if v_gym_id is null then
    return;
  end if;
  if not public.user_can_access_staff_area(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
    select
      (row_number() over (order by w.position))::int as rank,
      w.profile_id,
      w.created_at as joined_at
    from public.class_waitlist w
    where w.class_session_id = p_session_id;
end;
$$;
grant execute on function public.waitlist_for_session(uuid) to authenticated;

-- ============================================================================
-- 4. join_waitlist / leave_waitlist
-- ============================================================================

create or replace function public.join_waitlist(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  sess      public.class_sessions;
  current_count int;
  next_pos  int;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

  if not public.is_booking_eligible(v_uid, sess.gym_id, p_session_id) then
    raise exception 'Not eligible to book this class';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;
  if current_count < sess.capacity then
    raise exception 'Class has spare capacity — book directly instead of joining the waitlist';
  end if;

  select coalesce(max(position), 0) + 1 into next_pos
    from public.class_waitlist
    where class_session_id = p_session_id;

  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
  values (sess.gym_id, p_session_id, v_uid, next_pos)
  on conflict (class_session_id, profile_id) do nothing;

  return public.my_waitlist_rank(p_session_id);
end;
$$;
grant execute on function public.join_waitlist(uuid) to authenticated;

create or replace function public.leave_waitlist(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.class_waitlist
    where class_session_id = p_session_id
      and profile_id = v_uid;
end;
$$;
grant execute on function public.leave_waitlist(uuid) to authenticated;

-- ============================================================================
-- 5. promote_from_waitlist trigger
-- ============================================================================
-- AFTER DELETE on class_bookings. Iterates the session's waitlist in
-- insertion order; for each entry, checks is_booking_eligible (so a
-- removed / paused / out-of-credits waiter is skipped); on the first
-- success, calls _book_class_for with the waiter's id passed as data
-- (NO auth impersonation), marks the new booking promoted_from_waitlist,
-- deletes the waitlist entry, and stops.
--
-- The pg_trigger_depth() > 1 guard serves three roles. DO NOT remove:
--   (a) re-entrancy escape — the helper's own work shouldn't re-fire
--       this trigger
--   (b) skip during the GDPR cascade (Phase 4 — we don't want to
--       promote into a class while a member is being erased)
--   (c) skip during a class-cancellation cascade — don't promote
--       into a vanishing session

create or replace function public.promote_from_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry         public.class_waitlist%rowtype;
  v_session_start timestamptz;
  v_booking_id    uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select starts_at into v_session_start
    from public.class_sessions
    where id = old.class_session_id;
  if v_session_start is null or v_session_start <= now() then
    return null;
  end if;

  for v_entry in
    select * from public.class_waitlist
    where class_session_id = old.class_session_id
    order by position
  loop
    -- _is_booking_eligible_for (NOT is_booking_eligible) — the public
    -- wrapper requires the caller to be the target or staff; in this
    -- trigger context auth.uid() is the cancelling user, which fails
    -- the check for every other waitlister.
    if not public._is_booking_eligible_for(
      v_entry.profile_id, v_entry.gym_id, old.class_session_id
    ) then
      continue;
    end if;

    begin
      v_booking_id := public._book_class_for(old.class_session_id, v_entry.profile_id);
    exception when others then
      -- Capacity race, constraint, etc.: treat as a skip.
      continue;
    end;

    if v_booking_id is null then
      -- Already had a booking (on-conflict-do-nothing path).
      delete from public.class_waitlist where id = v_entry.id;
      continue;
    end if;

    update public.class_bookings
      set promoted_from_waitlist = true
      where id = v_booking_id;

    delete from public.class_waitlist where id = v_entry.id;
    return null;
  end loop;

  return null;
end;
$$;

create trigger promote_from_waitlist_trg
  after delete on public.class_bookings
  for each row execute function public.promote_from_waitlist();
