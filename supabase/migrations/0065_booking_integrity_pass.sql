-- Phase QA pass — booking integrity.
--
-- Three correctness bugs introduced across Phases 1–2 get fixed here,
-- properly (no replica-mode hack, no silent seat loss, no negative
-- balances):
--
-- 1. CASCADE-ON-CANCEL ORPHANS. 0054 wrapped the session DELETE in
--    `session_replication_role = 'replica'` to stop the BEFORE DELETE
--    refund trigger double-firing on the cascade. But replica mode
--    disables ALL triggers — including the referential-integrity
--    trigger that implements ON DELETE CASCADE — so the child
--    class_bookings rows were never deleted and ended up orphaned,
--    pointing at a session row that no longer exists.
--
--    Fix: a transaction-local GUC (`temple.skip_booking_refund`) tells
--    the refund trigger to no-op during an admin cancellation. The
--    explicit refund loop in _cancel_session_internal still runs
--    (full refund — the gym cancelled, members aren't penalised by the
--    cancel cutoff); then the normal session DELETE cascades and the
--    refund trigger skips via the flag. FK integrity is preserved.
--
-- 2. WAITLIST PROMOTION BLOCKED BY BOOKING CUTOFFS. promote_from_waitlist
--    calls _book_class_for with auth.uid() = the cancelling member, so
--    user_can_assign_plan is false and the booking-window cutoff check
--    fired — a late drop-out within the cutoff silently failed to
--    promote the next person (caught by `exception when others`).
--
--    Fix: _book_class_for grows `p_enforce_windows` (default true). The
--    window checks run only when `p_enforce_windows AND NOT staff`.
--    book_class passes true (member self-book), staff_book_member and
--    the promotion trigger pass false.
--
-- 3. CREDIT DOUBLE-SPEND RACE. The decrement had no lower bound; two
--    concurrent bookings on a 1-credit pass could drive the balance
--    negative. Declarative CHECK constraints make a negative balance
--    abort the transaction, turning a silent double-spend into a
--    failed second booking.

begin;

-- ============================================================================
-- 1. Non-negative credit guards
-- ============================================================================

-- Clamp any balance the pre-0065 race may already have driven negative
-- on the live database, so the constraint can be added cleanly.
update public.plan_subscriptions set credit_balance = 0 where credit_balance < 0;
update public.comp_grants set credits_remaining = 0 where credits_remaining < 0;

alter table public.plan_subscriptions
  add constraint plan_subscriptions_credit_balance_non_negative
  check (credit_balance is null or credit_balance >= 0);

alter table public.comp_grants
  add constraint comp_grants_credits_remaining_non_negative
  check (credits_remaining is null or credits_remaining >= 0);

-- ============================================================================
-- 2. _book_class_for — p_enforce_windows + class-type overrides + burn
-- ============================================================================

drop function if exists public._book_class_for(uuid, uuid, text, uuid, uuid);

create function public._book_class_for(
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

  -- Booking-window gates apply to member self-booking only. Staff
  -- (user_can_assign_plan) bypass for on-behalf bookings; waitlist
  -- promotion passes p_enforce_windows = false so a late drop-out
  -- still promotes the next member even inside the cutoff.
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

  -- Burn one credit on a fresh booking. The non-negative CHECK
  -- constraints (this migration) abort the transaction if a race
  -- would drive a finite balance below zero, so the second concurrent
  -- booking fails instead of double-spending. Unlimited plans / comps
  -- (NULL counters) are untouched.
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

-- ============================================================================
-- 3. book_class — member self-book, windows enforced
-- ============================================================================

create or replace function public.book_class(
  session_id           uuid,
  p_entitlement_kind   text default null,
  p_entitlement_id     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_booking_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  v_booking_id := public._book_class_for(
    session_id, v_uid, p_entitlement_kind, p_entitlement_id, v_uid, true);
  return v_booking_id;
end;
$$;
grant execute on function public.book_class(uuid, text, uuid) to authenticated;

-- ============================================================================
-- 4. staff_book_member — windows bypassed (walk-ups, transfers)
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
  select gym_id into v_gym_id from public.class_sessions where id = p_session_id;
  if v_gym_id is null then
    raise exception 'Class not found';
  end if;
  if not public.user_can_assign_plan(v_gym_id) then
    raise exception 'Not authorised to book on a member''s behalf';
  end if;
  v_booking_id := public._book_class_for(
    p_session_id, p_member_profile_id,
    p_entitlement_kind, p_entitlement_id, auth.uid(), false);
  return v_booking_id;
end;
$$;
grant execute on function public.staff_book_member(uuid, uuid, text, uuid)
  to authenticated;

-- ============================================================================
-- 5. promote_from_waitlist — bypass windows for the promoted member
-- ============================================================================

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
    if not public._is_booking_eligible_for(
      v_entry.profile_id, v_entry.gym_id, old.class_session_id
    ) then
      continue;
    end if;

    begin
      -- p_enforce_windows = false: the booking cutoff governs new
      -- member bookings, not promotions off the waitlist.
      v_booking_id := public._book_class_for(
        old.class_session_id, v_entry.profile_id, null, null, null, false);
    exception when others then
      continue;
    end;

    if v_booking_id is null then
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

-- ============================================================================
-- 6. Refund trigger honours the admin-cancel skip flag
-- ============================================================================

create or replace function public._refund_on_booking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff    integer;
  v_ct_cutoff integer;
  v_starts_at timestamptz;
  v_ct_id     uuid;
begin
  -- Admin cancellation refunds every booking up-front (full, ignoring
  -- the cancel cutoff) and sets this flag so the cascade DELETE doesn't
  -- double-refund. Member self-cancel never sets it.
  if coalesce(current_setting('temple.skip_booking_refund', true), 'off') = 'on' then
    return old;
  end if;

  select starts_at, class_type_id
    into v_starts_at, v_ct_id
    from public.class_sessions
    where id = old.class_session_id;
  if v_starts_at is null then
    return old;
  end if;

  select cancel_cutoff_minutes_before into v_ct_cutoff
    from public.class_types where id = v_ct_id;

  select coalesce(v_ct_cutoff, cancel_cutoff_minutes_before, 0)
    into v_cutoff
    from public.gyms where id = old.gym_id;

  -- Late-cancel forfeit: the booking still deletes but the credit
  -- stays burned.
  if v_cutoff > 0
     and v_starts_at - make_interval(mins => v_cutoff) <= now()
  then
    return old;
  end if;

  perform public._refund_booking_credit(old.class_session_id, old.profile_id);
  return old;
end;
$$;

revoke execute on function public._refund_on_booking_delete()
  from public, anon, authenticated;

-- ============================================================================
-- 7. _cancel_session_internal — explicit refund + flagged cascade
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
  -- Full refund for every booked member — a gym-initiated cancellation
  -- never penalises members with the cancel cutoff.
  for v_profile_id in
    select profile_id from public.class_bookings
    where class_session_id = p_session_id
  loop
    perform public._refund_booking_credit(p_session_id, v_profile_id);
  end loop;

  -- Empty the waitlist first so the cascade-fired promotion trigger has
  -- nothing to promote into the vanishing session.
  delete from public.class_waitlist where class_session_id = p_session_id;

  -- Suppress the BEFORE DELETE refund trigger for the cascade (the loop
  -- above already refunded). Unlike session_replication_role = replica,
  -- this leaves the ON DELETE CASCADE intact, so the child bookings are
  -- actually deleted rather than orphaned.
  set local temple.skip_booking_refund = 'on';
  delete from public.class_sessions where id = p_session_id;
  set local temple.skip_booking_refund = 'off';
end;
$$;

revoke execute on function public._cancel_session_internal(uuid)
  from public, anon, authenticated;

commit;
