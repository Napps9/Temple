-- Configurable "must have a membership to book".
--
-- Until now the only entitlement gate was the 0066 protection: a member
-- self-booking with no eligible entitlement was refused *only* if they
-- already held a plan_subscription here (lapsed / out of credits). Gyms
-- that sell plans want a stronger rule — no active membership, no
-- booking — but membership-access gyms must keep booking on the
-- gym_membership alone. Make it a setting instead of a guess:
--
--   gyms.require_membership_to_book            — gym-wide, applies to
--       members (role = 'member'). Default false (unchanged behaviour).
--   gym_memberships.require_membership_to_book — per-person override
--       (NULL = inherit). Staff/coaches/owners are exempt by default;
--       set this true to require a membership for a specific staff
--       member who also trains.
--
-- The booking refusal now fires when, for a self-booking with no eligible
-- entitlement, EITHER the effective requirement is true OR the original
-- holds-a-lapsed-plan protection applies. Message is prefixed "Membership
-- required" so the booking surface can show the plan options inline.

begin;

alter table public.gyms
  add column if not exists require_membership_to_book boolean not null default false;

alter table public.gym_memberships
  add column if not exists require_membership_to_book boolean;

-- Owner-only: flip the gym-wide rule.
create or replace function public.set_require_membership_to_book(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change booking settings';
  end if;
  update public.gyms
    set require_membership_to_book = p_enabled
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_require_membership_to_book(uuid, boolean) to authenticated;

-- Owner/admin: set (or clear, with NULL) the per-person override.
create or replace function public.set_member_booking_requirement(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_value      boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = auth.uid()
      and role in ('owner', 'admin')
  ) then
    raise exception 'Only an owner or admin can change this';
  end if;
  update public.gym_memberships
    set require_membership_to_book = p_value
    where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;
grant execute on function public.set_member_booking_requirement(uuid, uuid, boolean) to authenticated;

-- Rework the entitlement gate (otherwise identical to 0066).
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
  -- false) bypass both. "Membership required" prefix lets the booking
  -- surface offer the plan options inline.
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
