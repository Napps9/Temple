-- Gate cover claims on the coach's class-type qualifications.
--
-- coach_class_type_qualifications (0031) stored a per-coach, per-
-- class-type `qualified` flag — coaches not certified for, say,
-- CrossFit Kids get an explicit `qualified = false` row. Until now it
-- was display-only on the Team tab: a disqualified coach could still
-- claim a cover offer for that class type.
--
-- This rewrites claim_cover to refuse when the claiming coach has an
-- explicit disqualification for the session's class type. The model
-- stays "qualified by default": no row = allowed, `qualified = true`
-- = allowed, `qualified = false` = blocked. Sessions with no class
-- type (class_type_id is null) are never blocked.
--
-- Everything else in the RPC is unchanged from 0014: offer lock +
-- no-double-claim, self-cover guard, coach-changed race guard, time-
-- overlap guard, coach swap, and the parent status roll-up.

begin;

create or replace function public.claim_cover(p_session_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid;
  v_offer         public.cover_request_sessions;
  v_session       public.class_sessions;
  v_overlap_count integer;
  v_open_siblings integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the offer (filter on claimed_by = null ensures no double-claim).
  select * into v_offer
    from public.cover_request_sessions
    where id = p_session_offer_id and claimed_by is null
    for update;
  if v_offer is null then
    raise exception 'Offer already claimed or cancelled';
  end if;

  if not public.user_can_cover(v_offer.gym_id) then
    raise exception 'Not authorised';
  end if;
  if v_offer.original_coach_id = v_uid then
    raise exception 'You cannot cover your own class';
  end if;

  -- Lock the class session; assert no race rewrote coach_id.
  select * into v_session
    from public.class_sessions
    where id = v_offer.class_session_id
    for update;
  if v_session is null then
    raise exception 'Class session not found';
  end if;
  if v_session.coach_id is distinct from v_offer.original_coach_id then
    raise exception 'Class coach changed since the offer was created';
  end if;

  -- Qualification gate: a coach with an explicit disqualification for
  -- this class type cannot cover it. Null class_type_id is unguarded.
  if v_session.class_type_id is not null and exists (
    select 1
    from public.coach_class_type_qualifications q
    where q.gym_id = v_offer.gym_id
      and q.profile_id = v_uid
      and q.class_type_id = v_session.class_type_id
      and q.qualified = false
  ) then
    raise exception 'You are not qualified to cover this class type';
  end if;

  -- Overlap check: caller cannot already be coaching at this time.
  select count(*) into v_overlap_count
    from public.class_sessions cs
    where cs.coach_id = v_uid
      and cs.id <> v_session.id
      and cs.starts_at < v_session.starts_at + (v_session.duration_minutes || ' minutes')::interval
      and cs.starts_at + (cs.duration_minutes || ' minutes')::interval > v_session.starts_at;
  if v_overlap_count > 0 then
    raise exception 'You are already coaching at that time';
  end if;

  -- Swap coach.
  update public.class_sessions
    set coach_id = v_uid
    where id = v_session.id;

  update public.cover_request_sessions
    set claimed_by = v_uid, claimed_at = now()
    where id = v_offer.id;

  -- Bump parent status: 'claimed' if all sibling offers now claimed, else 'partial'.
  select count(*) into v_open_siblings
    from public.cover_request_sessions
    where request_id = v_offer.request_id and claimed_by is null;

  update public.cover_requests
    set status = case when v_open_siblings = 0 then 'claimed' else 'partial' end
    where id = v_offer.request_id;
end;
$$;

commit;
