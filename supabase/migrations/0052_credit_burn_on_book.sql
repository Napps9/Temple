-- Phase 1d — burn credits when a booking is created.
--
-- The picker has filtered eligible to `credit_balance > 0` /
-- `credits_remaining > 0` since 0011, but nothing else writes those
-- down. A credit-pack member who books and books and books never
-- sees the balance fall — the eligibility check is ornamental until
-- something actually decrements.
--
-- Fix lives in _book_class_for: after the booking insert succeeds
-- (RETURNING id is not null) and a finite entitlement was chosen,
-- decrement the count. Unlimited plans and comp grants with NULL
-- credits_remaining skip the decrement (they're unmetered). The
-- refund path (0018, updated in 0050) already increments on cancel,
-- so the two sides now balance.
--
-- Waitlist promotion path: when the picker returns no row (auth gate
-- mismatch), v_kind/v_id are NULL and the decrement is a no-op. The
-- refund-on-cancel for that booking will also be a no-op via the
-- legacy inference path, so the net is still correct.

begin;

create or replace function public._book_class_for(
  p_session_id              uuid,
  p_profile_id              uuid,
  p_entitlement_kind        text default null,
  p_entitlement_id          uuid default null,
  p_booked_by_profile_id    uuid default null
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

  select archived_at into v_archived_at
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  select parq_expiry_days into v_parq_days from public.gyms where id = sess.gym_id;
  v_parq_days := coalesce(v_parq_days, 365);

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

  -- Burn one credit when the booking row actually landed (on_conflict
  -- skipped if the member was already booked). Skip unlimited comps
  -- (credits_remaining NULL) and unlimited plans (mp.kind = unlimited).
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
  public._book_class_for(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;

commit;
