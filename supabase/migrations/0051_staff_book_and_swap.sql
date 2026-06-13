-- Phase 1b — staff-side booking + retroactive entitlement swap.
--
-- 1a wired the picker into book_class so a member with multiple
-- eligible plans gets to pick which one consumes the booking. 1b
-- adds the two staff-facing flows the coach needs:
--
--   1. staff_book_member(session_id, member_profile_id, kind?, id?)
--      A coach or owner books a class on a member's behalf. Walk-ups,
--      transfers from another class, comp slots. Routes through
--      _book_class_for; the staff member is the booker (recorded on
--      booked_by_profile_id), the target member is the seat-holder.
--      An entitlement choice is optional — if omitted the default
--      picker fires; if supplied, must be eligible for the target
--      member (list_booking_entitlements check).
--
--   2. swap_booking_subscription(booking_id, kind, id)
--      Retroactively change which entitlement an existing booking is
--      charged against. The cancel-refund path (0018, updated in
--      0050) reads used_entitlement_kind/id from the booking row, so
--      updating that pointer is the whole job. No audit table for v1.
--
-- Both gates check user_can_assign_plan, the same predicate that
-- guards comp grants and plan-subscription writes — coach is the
-- floor.

begin;

-- ============================================================================
-- 1. staff_book_member
-- ============================================================================

create or replace function public.staff_book_member(
  p_session_id          uuid,
  p_member_profile_id   uuid,
  p_entitlement_kind    text default null,
  p_entitlement_id      uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id     uuid;
  v_booking_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select gym_id into v_gym_id
    from public.class_sessions
    where id = p_session_id;
  if v_gym_id is null then
    raise exception 'Class not found';
  end if;

  if not public.user_can_assign_plan(v_gym_id) then
    raise exception 'Not authorised to book on a member''s behalf';
  end if;

  v_booking_id := public._book_class_for(
    p_session_id, p_member_profile_id,
    p_entitlement_kind, p_entitlement_id, auth.uid());
  return v_booking_id;
end;
$$;
grant execute on function public.staff_book_member(uuid, uuid, text, uuid)
  to authenticated;

-- ============================================================================
-- 2. swap_booking_subscription
-- ============================================================================
--
-- Verification: the new entitlement must be eligible for the
-- session-the-booking-is-for, attributed to the booking's profile.
-- list_booking_entitlements already does this exact check (and we
-- pass the booking's profile_id so a swap on a member's booking
-- doesn't accidentally validate against the staff member's plans).

create or replace function public.swap_booking_subscription(
  p_booking_id          uuid,
  p_entitlement_kind    text,
  p_entitlement_id      uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id     uuid;
  v_session_id uuid;
  v_profile_id uuid;
  v_eligible   boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_entitlement_kind is null or p_entitlement_id is null then
    raise exception 'Entitlement kind and id are both required';
  end if;
  if p_entitlement_kind not in ('comp_grant', 'plan_subscription') then
    raise exception 'Invalid entitlement kind: %', p_entitlement_kind;
  end if;

  select gym_id, class_session_id, profile_id
    into v_gym_id, v_session_id, v_profile_id
    from public.class_bookings
    where id = p_booking_id;
  if v_gym_id is null then
    raise exception 'Booking not found';
  end if;

  if not public.user_can_assign_plan(v_gym_id) then
    raise exception 'Not authorised to swap this booking';
  end if;

  select exists (
    select 1
    from public.list_booking_entitlements(v_session_id, v_profile_id) e
    where e.kind::text = p_entitlement_kind and e.id = p_entitlement_id
  ) into v_eligible;
  if not v_eligible then
    raise exception
      'Chosen entitlement is not eligible for this member at this class';
  end if;

  update public.class_bookings
    set used_entitlement_kind = p_entitlement_kind,
        used_entitlement_id   = p_entitlement_id
    where id = p_booking_id;
end;
$$;
grant execute on function public.swap_booking_subscription(uuid, text, uuid)
  to authenticated;

commit;
