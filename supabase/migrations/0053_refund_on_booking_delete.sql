-- Refund credits on every class_bookings DELETE.
--
-- 0018 only refunded credits when a coach cancelled the session
-- (_cancel_session_internal walks the bookings, calls
-- _refund_booking_credit, then deletes the session). Member
-- self-cancel goes through a direct DELETE on class_bookings (RLS
-- allows it), and the refund was never wired into that path —
-- credits the member "burned" via 0052 stayed gone.
--
-- Fix: a BEFORE DELETE trigger on class_bookings that calls the
-- existing refund helper. BEFORE so the row's used_entitlement_*
-- pointer is still readable. The trigger fires for every DELETE
-- path:
--   - member self-cancel  → refund the chosen entitlement
--   - admin session cancel → cascade deletes refire the trigger
--     (the explicit loop in _cancel_session_internal is now redundant
--     and is removed)
--   - waitlist promotion-induced DELETE: doesn't happen (waitlist
--     promotes ADD a booking, they don't delete one)
--   - leave_gym cascade  → refunds onto the (now-cancelled) sub.
--     Harmless: the member can't use the credit once they've left.

begin;

-- ============================================================================
-- 1. Trigger function
-- ============================================================================

create or replace function public._refund_on_booking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._refund_booking_credit(old.class_session_id, old.profile_id);
  return old;
end;
$$;

revoke execute on function public._refund_on_booking_delete()
  from public, anon, authenticated;

drop trigger if exists refund_on_booking_delete on public.class_bookings;
create trigger refund_on_booking_delete
  before delete on public.class_bookings
  for each row execute function public._refund_on_booking_delete();

-- ============================================================================
-- 2. _cancel_session_internal: drop the now-redundant explicit loop
-- ============================================================================

create or replace function public._cancel_session_internal(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.class_waitlist where class_session_id = p_session_id;
  -- The session DELETE cascades to class_bookings; the BEFORE DELETE
  -- trigger refunds each one. promote_from_waitlist is a no-op
  -- because the waitlist is already empty and starts_at moves into
  -- the past for the trigger's guard.
  delete from public.class_sessions where id = p_session_id;
end;
$$;

revoke execute on function public._cancel_session_internal(uuid)
  from public, anon, authenticated;

commit;
