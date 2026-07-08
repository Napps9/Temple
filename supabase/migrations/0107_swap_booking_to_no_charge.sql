-- Staff can already comp a *new* seat via staff_book_member(p_no_charge)
-- (0103), but there was no way to comp a booking that already exists:
-- swap_booking_subscription only re-pointed a booking at another
-- eligible plan/comp and always required a kind + id. So "Olivia's on
-- Unlimited but this session is on the house" had no path — you'd have
-- to cancel and re-book no-charge, losing the seat and booked_by trail.
--
-- Add a p_no_charge branch. Unlike a plan-to-plan swap (which, by v1
-- design, moves the pointer without touching credits — see 0051), a
-- swap *to free* refunds the credit debited at book time via the same
-- _refund_booking_credit helper the cancel path uses (0053), then nulls
-- the used_entitlement_* pointer so the seat is genuinely unbilled.
-- Non-credit sources (Unlimited plans, comps with null credits) refund
-- to a no-op — the helper's WHERE clauses already guard that. This is
-- exactly the refund 0103 flagged as the reason swap-to-free was out of
-- scope there; the helper makes it a small change now.
--
-- Arity changes (new trailing param), so DROP first — CREATE OR REPLACE
-- can't change arity (0043 lesson).

begin;

drop function if exists public.swap_booking_subscription(uuid, text, uuid);

create function public.swap_booking_subscription(
  p_booking_id          uuid,
  p_entitlement_kind    text default null,
  p_entitlement_id      uuid default null,
  p_no_charge           boolean default false
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

  if p_no_charge then
    perform public._refund_booking_credit(v_session_id, v_profile_id);
    update public.class_bookings
      set used_entitlement_kind = null,
          used_entitlement_id   = null
      where id = p_booking_id;
    return;
  end if;

  if p_entitlement_kind is null or p_entitlement_id is null then
    raise exception 'Entitlement kind and id are both required';
  end if;
  if p_entitlement_kind not in ('comp_grant', 'plan_subscription') then
    raise exception 'Invalid entitlement kind: %', p_entitlement_kind;
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
grant execute on function
  public.swap_booking_subscription(uuid, text, uuid, boolean)
  to authenticated;

commit;
