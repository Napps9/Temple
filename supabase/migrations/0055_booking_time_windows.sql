-- Phase 2 — booking time windows.
--
-- Three per-gym dials that nearly every booking-platform exposes,
-- finally configurable:
--
--   - booking_window_hours_ahead  (null = unlimited)
--     How many hours before class start a member can first book.
--     A 168 here gives the classic "books open one week ahead".
--
--   - booking_cutoff_minutes_before  (default 0)
--     Minimum minutes before class start a member can still book.
--     60 here gives the classic "book by an hour before".
--
--   - cancel_cutoff_minutes_before  (default 0)
--     Minimum minutes before class start a cancellation still
--     refunds the credit. Past this, the booking can still be
--     cancelled, but the credit stays burned ("late-cancel
--     forfeit"). 120 = 2h notice, 1440 = 24h notice.
--
-- All three default to 'unlimited / no cutoff' so existing gyms see
-- zero behaviour change until they tune them. The check constraint
-- mirrors the column intent (no negative values).

begin;

-- ============================================================================
-- 1. Columns
-- ============================================================================

alter table public.gyms
  add column if not exists booking_window_hours_ahead  integer
    check (booking_window_hours_ahead is null
           or booking_window_hours_ahead > 0),
  add column if not exists booking_cutoff_minutes_before integer not null default 0
    check (booking_cutoff_minutes_before >= 0),
  add column if not exists cancel_cutoff_minutes_before  integer not null default 0
    check (cancel_cutoff_minutes_before >= 0);

-- ============================================================================
-- 2. _book_class_for honours the two booking windows
-- ============================================================================
--
-- Two new gates inline alongside the existing PAR-Q / waiver / capacity
-- checks. The thrown messages start with the literal "Booking" so the
-- existing errorMessage UI surfaces them verbatim.

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
  v_window_hrs   integer;
  v_book_cutoff  integer;
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

  select parq_expiry_days,
         booking_window_hours_ahead,
         booking_cutoff_minutes_before
    into v_parq_days, v_window_hrs, v_book_cutoff
    from public.gyms
    where id = sess.gym_id;
  v_parq_days   := coalesce(v_parq_days, 365);
  v_book_cutoff := coalesce(v_book_cutoff, 0);

  -- Booking-window gates. Staff (user_can_assign_plan) bypass both —
  -- a coach booking a member into a far-future or last-minute class
  -- on their behalf isn't subject to the member-facing window.
  if not public.user_can_assign_plan(sess.gym_id) then
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

-- ============================================================================
-- 3. Refund trigger honours the late-cancel forfeit
-- ============================================================================
--
-- Late cancel: the booking still deletes (members can always cancel),
-- but the credit stays burned. Skip the refund call when starts_at -
-- cancel_cutoff <= now. The trigger fires for every DELETE path; the
-- check is universal.

create or replace function public._refund_on_booking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff    integer;
  v_starts_at timestamptz;
begin
  select starts_at into v_starts_at
    from public.class_sessions
    where id = old.class_session_id;
  if v_starts_at is null then
    -- Parent session already gone (cascade path); refund deferred to
    -- the explicit loop in _cancel_session_internal.
    return old;
  end if;

  select coalesce(cancel_cutoff_minutes_before, 0) into v_cutoff
    from public.gyms
    where id = old.gym_id;

  if v_cutoff > 0
     and v_starts_at - make_interval(mins => v_cutoff) <= now()
  then
    -- Late-cancel forfeit: the booking still deletes but the credit
    -- stays burned.
    return old;
  end if;

  perform public._refund_booking_credit(old.class_session_id, old.profile_id);
  return old;
end;
$$;

revoke execute on function public._refund_on_booking_delete()
  from public, anon, authenticated;

-- ============================================================================
-- 4. set_gym_operating_defaults: extend with the three window fields
-- ============================================================================
--
-- Owners surface change via the existing Operating defaults panel.
-- DROP the 11-arg form first; the new 14-arg form has defaults on the
-- three new fields so the existing UI's 11-arg call still resolves
-- once the client re-codegens against the new types.

drop function if exists public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer, integer, text
);

create or replace function public.set_gym_operating_defaults(
  p_gym_id                          uuid,
  p_week_starts_on                  text,
  p_timezone                        text,
  p_default_class_capacity          integer,
  p_default_class_minutes           integer,
  p_expiring_within_days            integer,
  p_parq_expiry_days                integer,
  p_health_retention_months         integer,
  p_lead_conversion_window_days     integer,
  p_materialisation_horizon_weeks   integer,
  p_subscription_resolution         text,
  p_booking_window_hours_ahead      integer default null,
  p_booking_cutoff_minutes_before   integer default 0,
  p_cancel_cutoff_minutes_before    integer default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change operating defaults';
  end if;
  update public.gyms
    set week_starts_on                  = p_week_starts_on,
        timezone                        = p_timezone,
        default_class_capacity          = p_default_class_capacity,
        default_class_minutes           = p_default_class_minutes,
        expiring_within_days            = p_expiring_within_days,
        parq_expiry_days                = p_parq_expiry_days,
        health_retention_months         = p_health_retention_months,
        lead_conversion_window_days     = p_lead_conversion_window_days,
        materialisation_horizon_weeks   = p_materialisation_horizon_weeks,
        subscription_resolution         = p_subscription_resolution,
        booking_window_hours_ahead      = p_booking_window_hours_ahead,
        booking_cutoff_minutes_before   = p_booking_cutoff_minutes_before,
        cancel_cutoff_minutes_before    = p_cancel_cutoff_minutes_before
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  integer, text, integer, integer, integer
) to authenticated;

commit;
