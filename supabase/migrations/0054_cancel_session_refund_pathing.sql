-- 0053 added a BEFORE DELETE refund trigger so member-self-cancel
-- (a raw DELETE on class_bookings) refunds credits the way the
-- admin-cancel path always did. It also collapsed
-- _cancel_session_internal into "just delete the session and let the
-- cascade do the rest" — that bit was wrong.
--
-- When ON DELETE CASCADE fires the child DELETEs, the parent
-- class_sessions row is already marked unreadable from the inside
-- view, so _refund_booking_credit's SELECT against class_sessions
-- returns NULL and the legacy inference path bails (no starts_at /
-- class_type_id to filter eligible plans). The pre-existing
-- cancel_session_refunds_credit_pack and
-- cancel_session_refunds_comp_grant tests caught this on the next CI
-- run.
--
-- Fix: restore the explicit refund loop _cancel_session_internal had
-- before, and bracket the cascade DELETE with
-- session_replication_role = 'replica' so the BEFORE DELETE refund
-- trigger doesn't double-fire on the cascading rows. Member
-- self-cancel still hits the trigger normally because no SECURITY
-- DEFINER wrapper disables triggers around their DELETE.

begin;

create or replace function public._cancel_session_internal(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  for v_profile_id in
    select profile_id from public.class_bookings
    where class_session_id = p_session_id
  loop
    perform public._refund_booking_credit(p_session_id, v_profile_id);
  end loop;

  delete from public.class_waitlist where class_session_id = p_session_id;

  -- Skip user triggers (including the BEFORE DELETE refund) during
  -- the cascade — the explicit loop above already refunded each
  -- booking. Restored immediately after.
  set local session_replication_role = 'replica';
  delete from public.class_sessions where id = p_session_id;
  set local session_replication_role = 'origin';
end;
$$;

revoke execute on function public._cancel_session_internal(uuid)
  from public, anon, authenticated;

commit;
