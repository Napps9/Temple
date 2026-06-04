-- Tier 7: cancel a class from the timetable.
--
-- Three RPCs:
--   cancel_session(p_session_id)              — one session
--   cancel_recurrence_from(p_session_id)      — this + all future in series
--   cancel_recurrence(p_recurrence_id)        — whole series (future only)
--
-- All three are SECURITY DEFINER, gated on user_can_admin_or_coach(gym_id),
-- and refuse when starts_at <= now() (past sessions are history; the UI
-- hides the button on past rows).
--
-- Each session cancellation, regardless of which RPC, does the same four
-- things in this order — the order is load-bearing:
--   1. Refund credits to booked members (comp grant first, else credit-pack sub).
--   2. Delete the session's class_waitlist rows.
--   3. Delete the session row.
--      ON DELETE CASCADE handles class_bookings and cover_request_sessions.
--      The promote_from_waitlist AFTER DELETE trigger fires per booking
--      cascade-delete, but: by step 2 the waitlist is empty for this session,
--      and by step 3 the session row is gone — its starts_at IS NULL guard
--      kicks in. Either path is a no-op. Pinned by no_promotion_into_cancelled_class.sql.
--
-- Refund inference: class_bookings has no entitlement_source column, so the
-- original debit's target is not recorded. _refund_booking_credit infers in
-- this precedence: an active comp_grant covering the session's starts_at
-- (matching the class_type_allowlist if set), else the current active
-- credit_pack / credit_period plan_subscription, else nothing (unlimited
-- members lose nothing). A future class_bookings.entitlement_source_id
-- column would make this exact; for now the inference is good enough for
-- the common case where members hold a single entitlement at a time.

-- ============================================================================
-- _refund_booking_credit (internal, no caller-auth check)
-- ============================================================================
create or replace function public._refund_booking_credit(
  p_session_id uuid,
  p_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id        uuid;
  v_starts_at     timestamptz;
  v_class_type_id uuid;
  v_grant_id      uuid;
  v_sub_id        uuid;
begin
  select gym_id, starts_at, class_type_id
    into v_gym_id, v_starts_at, v_class_type_id
    from public.class_sessions
    where id = p_session_id;
  if v_gym_id is null then
    return;  -- session already gone (defensive; shouldn't happen on the cancel path)
  end if;

  -- Comp grant first: active at the session's starts_at, with credits, and
  -- (if scoped) covering this class type. Prefer the soonest-expiring grant.
  select grant_id into v_grant_id
    from public.comp_grants
    where profile_id = p_profile_id
      and gym_id     = v_gym_id
      and revoked_at is null
      and credits_remaining is not null
      and credits_total     is not null
      and starts_at <= v_starts_at
      and ends_at   >  v_starts_at
      and (
        cardinality(class_type_allowlist) = 0
        or v_class_type_id = any(class_type_allowlist)
      )
    order by ends_at
    limit 1;
  if v_grant_id is not null then
    update public.comp_grants
      set credits_remaining = credits_remaining + 1
      where grant_id = v_grant_id;
    return;
  end if;

  -- Else: current active credit-pack / credit-period sub.
  select ps.id into v_sub_id
    from public.plan_subscriptions ps
    join public.membership_plans   mp on mp.plan_id = ps.plan_id
    where ps.profile_id = p_profile_id
      and ps.gym_id     = v_gym_id
      and ps.status     = 'active'::public.plan_sub_state
      and ps.credit_balance is not null
      and mp.kind in ('credit_pack', 'credit_period')
    limit 1;
  if v_sub_id is not null then
    update public.plan_subscriptions
      set credit_balance = credit_balance + 1
      where id = v_sub_id;
  end if;
  -- else: unlimited or no active entitlement — nothing to refund.
end;
$$;

-- Internal helper; never callable as an RPC.
revoke execute on function public._refund_booking_credit(uuid, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- _cancel_session_internal (internal; auth checked by public wrappers)
-- ============================================================================
create or replace function public._cancel_session_internal(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  -- 1. Refund credits to every currently-booked member.
  for v_profile_id in
    select profile_id from public.class_bookings
    where class_session_id = p_session_id
  loop
    perform public._refund_booking_credit(p_session_id, v_profile_id);
  end loop;

  -- 2. Drop the waitlist so the promotion trigger has no candidates when
  --    the cascade-delete fires.
  delete from public.class_waitlist where class_session_id = p_session_id;

  -- 3. Delete the session. ON DELETE CASCADE on class_bookings and
  --    cover_request_sessions handles those; promote_from_waitlist is a
  --    no-op because (a) waitlist is empty and (b) the trigger's
  --    starts_at IS NULL guard catches the post-delete state regardless.
  delete from public.class_sessions where id = p_session_id;
end;
$$;

revoke execute on function public._cancel_session_internal(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- cancel_session — single session
-- ============================================================================
create or replace function public.cancel_session(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id    uuid;
  v_starts_at timestamptz;
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
    raise exception 'Cannot cancel a session that has already started' using errcode = 'P0001';
  end if;

  perform public._cancel_session_internal(p_session_id);
  return 1;
end;
$$;

-- ============================================================================
-- cancel_recurrence_from — this session + every future sibling
-- ============================================================================
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

-- ============================================================================
-- cancel_recurrence — every future session in the series + delete recurrence
-- Past sessions stay as history (class_sessions.recurrence_id is ON DELETE
-- SET NULL, so they keep their data minus the recurrence link).
-- ============================================================================
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
    perform public._cancel_session_internal(v_sib_id);
    v_count := v_count + 1;
  end loop;

  -- Delete the recurrence row. class_sessions.recurrence_id has ON DELETE
  -- SET NULL, so past sessions survive with recurrence_id = null.
  delete from public.class_recurrences where id = p_recurrence_id;

  return v_count;
end;
$$;
