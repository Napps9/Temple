-- Four checks that named one thing and tested another
--
-- Found while wiring the money verbs; none of them new. All four were
-- reachable before any of the chat work existed, and all four are the
-- same mistake in different clothes: a check that names one thing and
-- tests another, or names nothing at all.
--
-- 1. A former member could never drop in again. _book_class_for's
--    "already holds a plan here" guard is an EXISTS with no status
--    filter, so somebody who paid for three months in 2024 and cancelled
--    is refused for ever at a gym that does not require membership to
--    book — while a stranger who never paid walks in. The database
--    already has the right predicate for this and has since 0015:
--    is_terminal_subscription_status, whose complement is exactly the
--    app's own CURRENT_SUB_STATUSES. The guard now uses it. What the
--    guard is actually for — no free booking once your credits run out —
--    is untouched: a credit plan at zero balance is still 'active', and
--    'active' is not terminal.
--
-- 2. pending_members could point at another gym's plan. Both plan
--    columns are plain FKs to membership_plans(plan_id) with no gym
--    constraint, and the two things that read them do not check either:
--    apply_pending_member_data looks the plan up by id alone and inserts
--    a plan_subscriptions row for THIS gym carrying THAT gym's plan, and
--    my_agreed_plan (security definer) joins the same way and shows a
--    member the other gym's plan name. Reachable two ways: the update
--    policy on pending_members is column-blind, so anyone with
--    can_manage_staff can PATCH a foreign plan uuid straight through
--    PostgREST, and import_pending_members takes the id from its jsonb
--    payload without validating it against the gym either. A trigger now
--    refuses a plan from another gym on both columns, whatever the path,
--    and existing mismatches are cleared.
--
--    Not a composite foreign key, which would be the obvious answer: its
--    ON DELETE SET NULL would have to null gym_id too, and gym_id is NOT
--    NULL, so deleting a plan would fail instead of clearing the link.
--
-- 3. my_agreed_plan gets the gym check anyway. The trigger stops new bad
--    rows and the cleanup clears old ones, but this function is a
--    security definer that hands a plan id to the member's own checkout,
--    so it should not depend on another statement having run first.
--
-- 4. And the update policy on pending_members names no column, so the
--    grant is the only thing deciding which fields a staff account may
--    write. See part 4 below — it is the 0195 argument, on a table 0195
--    missed.

-- ---------------------------------------------------------------------------
-- 1. A cancelled membership is not a membership you hold
-- ---------------------------------------------------------------------------

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
    -- A subscription that has lapsed or been cancelled is not a
    -- membership they still hold: it is one they used to. Testing for
    -- the mere existence of a row punished a former member for ever
    -- having paid, while a stranger with no history walked in. The
    -- protection this is actually for — no free booking past your
    -- credits — is untouched, because a credit plan at zero balance is
    -- still 'active' and still not terminal.
    v_holds_plan := v_role = 'member' and exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = p_profile_id and ps.gym_id = sess.gym_id
        and not public.is_terminal_subscription_status(ps.status)
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

-- ---------------------------------------------------------------------------
-- 2. A pending member's plan belongs to their own gym
-- ---------------------------------------------------------------------------

-- Clear what is already wrong before constraining it. Nulling is the
-- honest repair: the plan that was meant is unknowable from here, and a
-- null link simply means the owner maps it again.
update public.pending_members pm
   set linked_membership_plan_id = null
 where pm.linked_membership_plan_id is not null
   and not exists (
     select 1 from public.membership_plans mp
     where mp.plan_id = pm.linked_membership_plan_id and mp.gym_id = pm.gym_id
   );

update public.pending_members pm
   set agreed_plan_id = null
 where pm.agreed_plan_id is not null
   and not exists (
     select 1 from public.membership_plans mp
     where mp.plan_id = pm.agreed_plan_id and mp.gym_id = pm.gym_id
   );

create or replace function public._pending_member_plans_are_this_gyms()
returns trigger
language plpgsql
as $$
begin
  if new.linked_membership_plan_id is not null
     and not exists (
       select 1 from public.membership_plans mp
       where mp.plan_id = new.linked_membership_plan_id
         and mp.gym_id  = new.gym_id
     )
  then
    raise exception 'Plan belongs to another gym';
  end if;

  if new.agreed_plan_id is not null
     and not exists (
       select 1 from public.membership_plans mp
       where mp.plan_id = new.agreed_plan_id
         and mp.gym_id  = new.gym_id
     )
  then
    raise exception 'Plan belongs to another gym';
  end if;

  return new;
end;
$$;

drop trigger if exists pending_members_plans_are_this_gyms on public.pending_members;

create trigger pending_members_plans_are_this_gyms
  before insert or update on public.pending_members
  for each row
  execute function public._pending_member_plans_are_this_gyms();

-- ---------------------------------------------------------------------------
-- 3. my_agreed_plan checks the gym itself
-- ---------------------------------------------------------------------------

create or replace function public.my_agreed_plan(p_gym_id uuid)
returns table (plan_id uuid, plan_name text)
language sql security definer set search_path = public
as $$
  select mp.plan_id, mp.name
  from public.pending_members pm
  join public.membership_plans mp
    on mp.plan_id = pm.agreed_plan_id
   and mp.gym_id  = pm.gym_id
  where pm.gym_id = p_gym_id
    and lower(pm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and mp.archived_at is null
    and not exists (
      select 1 from public.plan_subscriptions ps
      where ps.gym_id = p_gym_id
        and ps.profile_id = auth.uid()
        and ps.status in
          ('active', 'pending', 'paused', 'cancelled_at_period_end', 'refunded_retained')
    )
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Only the columns the screen edits are the client's to write
-- ---------------------------------------------------------------------------
--
-- The update policy is column-blind — effective_can(gym_id,
-- 'can_manage_staff') and nothing about WHICH column — so the grant is
-- the only thing standing between a staff account and every field on the
-- row. The one client update Temple makes (the imported-member detail
-- screen) writes thirteen columns, all of them the owner's own typing.
-- The rest are written by security-definer RPCs or the service role:
-- status and linked_* by the claim trigger and import_pending_members,
-- agreed_plan_id by the front desk's close-plan RPC and
-- clear_my_agreed_plan, imported_stripe_* by the Stripe import, gym_id
-- and created_by never.
--
-- imported_stripe_subscription_id is the one that matters. The claim
-- trigger copies it onto the plan_subscriptions row it creates, so a
-- writable copy of that column is a way to attach one member's live
-- Stripe subscription to another member's membership. 0195 made this
-- argument for four other tables; pending_members was missed.
--
-- INSERT goes entirely: nothing client-side has ever inserted a
-- pending member. Every staging path — the CSV import, the Stripe
-- import, the setup flow, the front desk's close-plan RPC — goes through
-- a security-definer function. A table-level INSERT grant was simply a
-- second way in, and the same one: it could have carried any column the
-- UPDATE grant now refuses.
--
-- Which leaves the trigger above doing the job only it can do. The grant
-- stops the client writing a foreign plan; it says nothing to
-- import_pending_members or earmark_pending_member_plan, which run as
-- definer and take the plan id from their arguments.
--
-- REVOKE then GRANT per column: revoking the table-level privilege is
-- what makes the column list exhaustive rather than additive.

revoke insert, update on public.pending_members from authenticated;

grant update (
  full_name,
  email,
  phone,
  date_of_birth,
  plan_name,
  plan_start,
  plan_end,
  next_bill_date,
  credits_remaining,
  emergency_contact,
  tags,
  notes,
  unsubscribed
) on public.pending_members to authenticated;
