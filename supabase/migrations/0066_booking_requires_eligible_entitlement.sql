-- Phase QA pass — close the "free booking past your credits" gap.
--
-- _book_class_for has never refused a booking for lack of an eligible
-- entitlement: it resolves one for attribution but books regardless.
-- That was inert until Phase 1 made credits real — now a credit-pack
-- member who runs out resolves no entitlement, burns nothing, and
-- keeps booking for free.
--
-- The fix has to stay flexible across the use-cases this platform
-- supports:
--   - Class gyms selling plans / packs / comps: out of credits or a
--     lapsed plan must block booking.
--   - Membership-access gyms that don't sell per-class entitlements:
--     a gym_membership alone grants booking.
--
-- So the rule auto-distinguishes them with no per-gym toggle: a member
-- self-booking with NO eligible entitlement is refused only when they
-- already hold a plan_subscription with this gym (they're on a
-- paid-plan relationship that simply isn't covering this class right
-- now). A member with no plan_subscription at all is booking on the
-- membership-access model and is allowed through unchanged.
--
-- Staff on-behalf bookings and waitlist promotion bypass (the latter
-- already gates on _is_booking_eligible_for before this runs).

begin;

create or replace function public._book_class_for(
  p_session_id              uuid,
  p_profile_id              uuid,
  p_entitlement_kind        text default null,
  p_entitlement_id          uuid default null,
  p_booked_by_profile_id    uuid default null,
  p_enforce_windows         boolean default true
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
  v_active_w     uuid;
  v_has_sig      boolean;
  v_parq_days    integer;
  v_kind         text;
  v_id           uuid;
  v_eligible     boolean;
  v_window_hrs   integer;
  v_book_cutoff  integer;
  v_ct_window    integer;
  v_ct_book      integer;
begin
  if p_profile_id is null then
    raise exception 'No profile to book for';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

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

  select archived_at,
         booking_window_hours_ahead,
         booking_cutoff_minutes_before
    into v_archived_at, v_ct_window, v_ct_book
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  select parq_expiry_days,
         booking_window_hours_ahead,
         booking_cutoff_minutes_before
    into v_parq_days, v_window_hrs, v_book_cutoff
    from public.gyms
    where id = sess.gym_id;
  v_parq_days   := coalesce(v_parq_days, 365);
  v_window_hrs  := coalesce(v_ct_window, v_window_hrs);
  v_book_cutoff := coalesce(v_ct_book,   coalesce(v_book_cutoff, 0));

  if p_enforce_windows and not public.user_can_assign_plan(sess.gym_id) then
    if v_window_hrs is not null
       and sess.starts_at > now() + make_interval(hours => v_window_hrs)
    then
      raise exception 'Booking not yet open for this class';
    end if;
    if v_book_cutoff > 0
       and sess.starts_at <= now() + make_interval(mins => v_book_cutoff)
    then
      raise exception 'Booking closed for this class';
    end if;
  end if;

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
       or v_last_resp.completed_at < (now() - make_interval(days => v_parq_days))
    then
      raise exception
        'PAR-Q required: complete the health screening before booking';
    end if;
  end if;

  select id into v_active_w
    from public.waiver_documents
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_w is not null then
    select exists (
      select 1 from public.waiver_signatures
      where gym_id = sess.gym_id
        and profile_id = p_profile_id
        and waiver_id = v_active_w
    ) into v_has_sig;
    if not v_has_sig then
      raise exception
        'Waiver required: sign the waiver before booking';
    end if;
  end if;

  if p_entitlement_kind is not null and p_entitlement_id is not null then
    select exists (
      select 1 from public.list_booking_entitlements(p_session_id, p_profile_id) e
      where e.kind::text = p_entitlement_kind and e.id = p_entitlement_id
    ) into v_eligible;
    if not v_eligible then
      raise exception 'Chosen entitlement is not eligible for this class';
    end if;
    v_kind := p_entitlement_kind;
    v_id   := p_entitlement_id;
  else
    select kind::text, id into v_kind, v_id
      from public._select_default_entitlement_unchecked(
        p_profile_id, sess.gym_id, p_session_id);
  end if;

  -- Entitlement requirement (flexible). A member self-booking with no
  -- eligible entitlement is refused only when they already hold a plan
  -- with this gym — i.e. they're on a paid-plan relationship that's
  -- out of credits or lapsed. Members on the membership-access model
  -- (no plan_subscription at all) book on membership alone. Staff and
  -- waitlist promotion (p_enforce_windows = false) bypass.
  if p_enforce_windows
     and not public.user_can_assign_plan(sess.gym_id)
     and v_id is null
     and exists (
       select 1 from public.plan_subscriptions ps
       where ps.profile_id = p_profile_id and ps.gym_id = sess.gym_id
     )
  then
    raise exception 'No active plan or credits cover this class';
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;

  if current_count >= sess.capacity then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings
    (gym_id, class_session_id, profile_id,
     used_entitlement_kind, used_entitlement_id, booked_by_profile_id)
  values (sess.gym_id, p_session_id, p_profile_id,
          v_kind, v_id, p_booked_by_profile_id)
  on conflict (class_session_id, profile_id) do nothing
  returning id into v_booking_id;

  if v_booking_id is not null then
    if v_kind = 'comp_grant' then
      update public.comp_grants
        set credits_remaining = credits_remaining - 1
        where grant_id = v_id
          and credits_remaining is not null;
    elsif v_kind = 'plan_subscription' then
      update public.plan_subscriptions ps
        set credit_balance = credit_balance - 1
        from public.membership_plans mp
        where mp.plan_id = ps.plan_id
          and ps.id = v_id
          and ps.credit_balance is not null
          and mp.kind in ('credit_pack', 'credit_period');
    end if;
  end if;

  return v_booking_id;
end;
$$;

revoke execute on function
  public._book_class_for(uuid, uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated;

commit;
