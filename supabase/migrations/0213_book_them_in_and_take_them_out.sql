-- Putting a member in a class, and taking them out again.
--
-- Both are things staff do constantly and neither had an honest write.
--
-- TAKING SOMEONE OUT had no RPC at all — only an RLS DELETE policy on
-- class_bookings whose predicate is user_can_admin_or_coach, which excludes
-- the `staff` role. PostgREST reports an RLS-blocked delete as success with
-- zero rows affected, not as an error, so a staff-role user pressing the
-- button would have seen it work and nothing would have happened. A definer
-- RPC removes that whole class of silence.
--
-- It also has to decide about money, which a bare delete cannot. Removing a
-- booking fires _refund_on_booking_delete, which returns the credit unless
-- the cancel cutoff has passed — and with cutoffs unset it returns the
-- credit even for a class that already ran. That is the right default when
-- you are pulling someone out as a favour and the wrong one when they did
-- not turn up, so the caller says which and the card asks. Suppressing it
-- needs the temple.skip_booking_refund GUC, which no client can set: this
-- is the same mechanism _cancel_session_internal uses, and the reason this
-- has to be a function rather than a policy.
--
-- OVERBOOKING was advertised and unenforced. can_issue_override has been a
-- live capability since 0020, sold on the Team screen as "Book a member
-- into a class outside normal rules", and _book_class_for's capacity check
-- refused everyone unconditionally — owners included. Same shape as
-- can_assign_plan before 0211: a promise the database could not keep.
--
-- _book_class_for is restated here rather than re-typed. Its body is 0103's
-- verbatim with exactly one changed condition: the capacity refusal now
-- consults a transaction-local GUC, set only by staff_book_member after it
-- has checked the capability. Six changed lines in a two-hundred-line
-- function, and the local harness (scripts/pgtap-local) proves the other
-- gates — membership, timing, PAR-Q, waiver, entitlement, require-membership
-- — all still fire. The signature is unchanged, so CREATE OR REPLACE is
-- safe and no caller needs touching.
--
-- staff_book_member does change arity, so it is dropped first. While it is
-- open: it returned NULL rather than raising when the member was already
-- booked (_book_class_for's `on conflict do nothing`), so a caller that
-- treated "no exception" as success reported a booking that never happened.
-- It now says so.

begin;

-- ============================================================================
-- 1. _book_class_for — capacity can be overridden, nothing else changes
-- ============================================================================

create or replace function public._book_class_for(
  p_session_id              uuid,
  p_profile_id              uuid,
  p_entitlement_kind        text default null,
  p_entitlement_id          uuid default null,
  p_booked_by_profile_id    uuid default null,
  p_enforce_windows         boolean default true,
  p_no_charge               boolean default false
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
  v_role         public.gym_role;
  v_override     boolean;
  v_gym_requires boolean;
  v_requires     boolean;
  v_holds_plan   boolean;
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

  if p_no_charge then
    v_kind := null;
    v_id   := null;
  elsif p_entitlement_kind is not null and p_entitlement_id is not null then
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

  -- Booking entitlement requirement. A self-booking that resolves no
  -- eligible entitlement (v_id is null) is refused when either:
  --   1. an active membership is required — for members via
  --      gyms.require_membership_to_book, for anyone via the per-person
  --      gym_memberships.require_membership_to_book override (staff are
  --      exempt by default); or
  --   2. the booker already holds a plan_subscription here that just
  --      isn't covering this class (lapsed / out of credits) — the
  --      original "no free booking past your credits" protection.
  -- Staff on-behalf bookings and waitlist promotion (p_enforce_windows =
  -- false) bypass both — that's also what lets p_no_charge through for
  -- a member who does hold a plan.
  if p_enforce_windows and v_id is null then
    select gm.role, gm.require_membership_to_book
      into v_role, v_override
      from public.gym_memberships gm
      where gm.gym_id = sess.gym_id and gm.profile_id = p_profile_id;
    select g.require_membership_to_book
      into v_gym_requires
      from public.gyms g where g.id = sess.gym_id;
    v_requires := coalesce(
      v_override,
      case when v_role = 'member' then v_gym_requires else false end
    );
    v_holds_plan := v_role = 'member' and exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = p_profile_id and ps.gym_id = sess.gym_id
    );
    if v_requires or v_holds_plan then
      raise exception 'Membership required: no active plan or credits cover this class';
    end if;
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = p_session_id;

  if current_count >= sess.capacity
     and coalesce(current_setting('temple.allow_over_capacity', true), 'off') <> 'on'
  then
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

-- ============================================================================
-- 2. staff_book_member — the override, and an honest double-book
-- ============================================================================
--
-- Arity change, so DROP first (0065 and 0103 both had to do the same to
-- this family). The GUC is set and cleared around the single call: SET LOCAL
-- inside a function is not restored on exit unless the function names the
-- parameter in its own SET clause, and this one deliberately does not, so
-- it is cleared by hand exactly as _cancel_session_internal does.

drop function if exists public.staff_book_member(uuid, uuid, text, uuid, boolean);

create function public.staff_book_member(
  p_session_id          uuid,
  p_member_profile_id   uuid,
  p_entitlement_kind    text default null,
  p_entitlement_id      uuid default null,
  p_no_charge           boolean default false,
  p_over_capacity       boolean default false
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

  if p_over_capacity then
    -- The capability the Team screen has been advertising since 0020,
    -- enforced for the first time.
    if not public.effective_can(v_gym_id, 'can_issue_override') then
      raise exception 'Not authorised to go over capacity';
    end if;
    set local temple.allow_over_capacity = 'on';
  end if;

  v_booking_id := public._book_class_for(
    p_session_id, p_member_profile_id,
    p_entitlement_kind, p_entitlement_id, auth.uid(), false, p_no_charge);

  if p_over_capacity then
    set local temple.allow_over_capacity = 'off';
  end if;

  -- _book_class_for inserts ON CONFLICT DO NOTHING, so a member who was
  -- already in the class comes back as NULL rather than as an error. Saying
  -- "booked" on that is a lie the caller cannot detect.
  if v_booking_id is null then
    raise exception 'Already booked into this class';
  end if;

  return v_booking_id;
end;
$$;

revoke execute on function
  public.staff_book_member(uuid, uuid, text, uuid, boolean, boolean)
  from public, anon;
grant execute on function
  public.staff_book_member(uuid, uuid, text, uuid, boolean, boolean)
  to authenticated;

-- ============================================================================
-- 3. remove_member_booking
-- ============================================================================
--
-- Returns a receipt rather than a row count, because a removal is never just
-- a removal: a credit may go back, and the AFTER DELETE trigger promotes the
-- first eligible person off the waitlist into the seat. Both are invisible
-- from the call site, and a card that mentions neither understates what the
-- owner is about to do — so both are reported.
--
-- The gate is effective_can(can_assign_plan), matching staff_book_member:
-- whoever may put someone into a class may take them out. That is
-- deliberately not the RLS policy's user_can_admin_or_coach, which is a raw
-- role check with no left_at guard and which excludes the staff role.

create or replace function public.remove_member_booking(
  p_gym_id     uuid,
  p_session_id uuid,
  p_profile_id uuid,
  p_refund     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_next       uuid;
  v_promoted   uuid;
  v_name       text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;

  select b.id into v_booking_id
    from public.class_bookings b
    join public.class_sessions cs on cs.id = b.class_session_id
    where b.class_session_id = p_session_id
      and b.profile_id = p_profile_id
      and cs.gym_id = p_gym_id;
  if v_booking_id is null then
    raise exception 'Not booked into this class';
  end if;

  -- Who the promotion trigger would reach for, read before the delete so it
  -- can be compared afterwards. Ordered the way promote_from_waitlist reads
  -- the queue.
  select w.profile_id into v_next
    from public.class_waitlist w
    where w.class_session_id = p_session_id
    order by w.position
    limit 1;

  if not p_refund then
    set local temple.skip_booking_refund = 'on';
  end if;
  delete from public.class_bookings where id = v_booking_id;
  if not p_refund then
    set local temple.skip_booking_refund = 'off';
  end if;

  -- The trigger swallows per-candidate failures, so "there was someone on
  -- the waitlist" is not the same as "they got in". Check.
  if v_next is not null and exists (
    select 1 from public.class_bookings
    where class_session_id = p_session_id and profile_id = v_next
  ) then
    v_promoted := v_next;
    select full_name into v_name from public.profiles where id = v_promoted;
  end if;

  return jsonb_build_object(
    'removed', true,
    'refunded', p_refund,
    'promoted_profile_id', v_promoted,
    'promoted_name', v_name
  );
end;
$$;

revoke execute on function
  public.remove_member_booking(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function
  public.remove_member_booking(uuid, uuid, uuid, boolean) to authenticated;

commit;
