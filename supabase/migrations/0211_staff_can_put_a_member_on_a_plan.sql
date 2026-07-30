-- Staff can put a member on a plan.
--
-- can_assign_plan has been advertised to owners since 0020 — the Team
-- screen sells it as "Put members onto plans and adjust subscriptions" —
-- and nothing in Temple has ever been able to do it. Members self-serve
-- through Stripe; comp grants are displayed and never issued; the only
-- staff-side membership mutations that exist are approving a request the
-- member filed and issuing a refund. This closes that.
--
-- The shape is not new. The CSV importer already implements exactly the
-- semantics we want: earmark a plan, and when the account is claimed the
-- member lands on a working membership that was never billed and never
-- asked them to sign up again (0076's "the imported continuation",
-- currently apply_pending_member_data in 0179). These functions extend
-- that same continuation to a member who is already here, rather than
-- inventing a second mechanism beside it.
--
-- Four things this had to get right, each of which is a trap laid by
-- existing code:
--
--  1. The row must be ENTITLING, never staged. _book_class_for's
--     require-membership gate (0103:198-204) tests for the mere
--     EXISTENCE of a plan_subscriptions row with no status filter, so a
--     row parked at 'pending' would not merely be unbookable — it would
--     permanently stop that member self-booking anything an entitlement
--     doesn't cover, even at a gym with require_membership_to_book off.
--     There is no such thing here as a harmless placeholder subscription.
--
--  2. price_cents is snapshotted by a BEFORE INSERT trigger only
--     (0015:71-73). A switch that changes plan_id without writing
--     price_cents explicitly silently grandfathers the member onto the
--     old plan's price — the same reason stripe-modify-subscription sets
--     it by hand.
--
--  3. The gate is effective_can, not user_can_assign_plan. The latter
--     (0013:112-125) is a raw role test with no left_at guard, so a
--     soft-removed staffer still passes it; 0195 pulled the client write
--     grant over exactly that. effective_can honours per-member and
--     per-role overrides and requires a live membership.
--
--  4. The plan is validated against the gym. apply_pending_member_data
--     looks a plan up by plan_id alone (0179:192-196) and
--     import_pending_members casts linked_membership_plan_id with no
--     tenancy check (0124:218), so a plan uuid from another gym can reach
--     plan_subscriptions today. Every function here checks gym_id and
--     archived_at itself rather than trusting a caller.
--
-- How long an assignment runs follows the plan's own period, because a
-- favour nobody can remember granting is how a gym leaks money: a
-- credit_period plan uses its period_length, anything else without one
-- gets a month, and a credit_pack gets no end date at all because its
-- credits are the limit — which is also why 0125's nightly lapse sweep
-- already excludes packs. An explicit p_until overrides all of that.

begin;

-- ============================================================================
-- 1. assign_member_plan — the member is already here
-- ============================================================================
--
-- Returns a jsonb receipt rather than a row so the caller can say what
-- happened in words: whether it created a membership or moved an existing
-- one, and when it runs to.
--
-- p_mode 'move' switches the membership they already have; 'add' leaves it
-- alone and gives them a second one. Both are legitimate — a programming
-- add-on alongside classes is a real second membership — so the caller
-- asks rather than this function guessing.

create or replace function public.assign_member_plan(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_plan_id    uuid,
  p_until      date default null,
  p_mode       text default 'move'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan       public.membership_plans%rowtype;
  v_membership public.gym_memberships%rowtype;
  v_existing   public.plan_subscriptions%rowtype;
  v_ends_at    timestamptz;
  v_credits    integer;
  v_sub_id     uuid;
  v_switched   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  if p_mode not in ('move', 'add') then
    raise exception 'Unknown mode';
  end if;

  select * into v_plan
    from public.membership_plans
    where plan_id = p_plan_id
      and gym_id = p_gym_id
      and archived_at is null;
  if v_plan.plan_id is null then
    raise exception 'No such plan';
  end if;

  -- left_at is null matters: the parent-match trigger (0008:152-178)
  -- checks the membership exists but never that it is live, so a removed
  -- member could otherwise be handed an entitling subscription.
  select * into v_membership
    from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;
  if v_membership.id is null then
    raise exception 'Not a member of this gym';
  end if;

  -- The plan's own period, unless the caller named an end. Stored as an
  -- EXCLUSIVE midnight boundary — the instant access stops — so that the
  -- last day always counts in full and 0125's 03:30 sweep lapses the row
  -- the morning after it ran out rather than during it. The same
  -- convention is used for a pending row's plan_end below, because
  -- apply_pending_member_data casts that straight into this column and
  -- the two paths must buy a member the same number of days.
  v_ends_at := case
    when p_until is not null then (p_until + 1)::timestamptz
    when v_plan.kind = 'credit_pack' then null
    when v_plan.period_length is not null
      then ((now() + v_plan.period_length)::date + 1)::timestamptz
    else ((now() + interval '1 month')::date + 1)::timestamptz
  end;

  -- programming_only carries credit_count is null by CHECK (0123:104-111)
  -- and so can never satisfy the booking predicate's credit test. Only
  -- the two credit kinds get a balance.
  v_credits := case
    when v_plan.kind in ('credit_pack', 'credit_period') then v_plan.credit_count
    else null
  end;

  if p_mode = 'move' then
    -- The newest entitling membership is the one they are on. Statuses
    -- match the booking predicate's (0050:118-127) so "what they're on"
    -- means the same thing here as it does at the door.
    select * into v_existing
      from public.plan_subscriptions
      where gym_id = p_gym_id
        and profile_id = p_profile_id
        and status in ('active', 'cancelled_at_period_end', 'refunded_retained')
      order by created_at desc
      limit 1;
  end if;

  if v_existing.id is not null then
    -- A live Stripe subscription is a billing change, not a row edit:
    -- swapping the price without telling Stripe would bill the old
    -- amount forever. stripe-modify-subscription owns that path.
    if v_existing.stripe_subscription_id is not null then
      raise exception 'Membership is billed by card'
        using hint = v_existing.id::text;
    end if;
    update public.plan_subscriptions
      set plan_id         = v_plan.plan_id,
          status          = 'active'::public.plan_sub_state,
          -- Explicit: the snapshot trigger is INSERT-only.
          price_cents     = v_plan.monthly_price_cents,
          credit_balance  = v_credits,
          paid_period_end = v_ends_at,
          imported_legacy = true,
          cancelled_at    = null
      where id = v_existing.id
      returning id into v_sub_id;
    v_switched := true;
  else
    insert into public.plan_subscriptions (
      gym_membership_id, profile_id, gym_id, plan_id,
      status, credit_balance, paid_period_end, price_cents,
      stripe_subscription_id, stripe_customer_id, priority,
      -- Unbilled but convertible: this is the flag stripe-checkout's
      -- adoption branch requires (index.ts:151-152) to put the member
      -- onto real billing by UPDATING this row rather than opening a
      -- second one, and the flag 0125's nightly sweep lapses on.
      imported_legacy
    ) values (
      v_membership.id, p_profile_id, p_gym_id, v_plan.plan_id,
      'active'::public.plan_sub_state, v_credits, v_ends_at,
      v_plan.monthly_price_cents,
      null, null, 0,
      true
    )
    returning id into v_sub_id;
  end if;

  return jsonb_build_object(
    'subscription_id', v_sub_id,
    'switched', v_switched,
    'plan_name', v_plan.name,
    'plan_kind', v_plan.kind,
    'price_cents', v_plan.monthly_price_cents,
    'credit_balance', v_credits,
    'ends_at', v_ends_at,
    -- The last day they can train, which is the date a person would say.
    -- The stored boundary is the midnight after it; a receipt that echoed
    -- that would name a day they no longer have.
    'runs_to', case when v_ends_at is not null then v_ends_at::date - 1 end
  );
end;
$$;

-- CREATE FUNCTION hands out a PUBLIC execute default that a later grant
-- does not cancel; 0196 exists because 0125 forgot this.
revoke execute on function public.assign_member_plan(uuid, uuid, uuid, date, text)
  from public, anon;
grant execute on function public.assign_member_plan(uuid, uuid, uuid, date, text)
  to authenticated;

-- ============================================================================
-- 2. earmark_pending_member_plan — the member hasn't claimed their account
-- ============================================================================
--
-- The same job for someone still on the import list. Nothing here is new
-- machinery: linked_membership_plan_id already means "grant this plan,
-- unbilled, when they sign up" (0076), and apply_pending_member_data
-- already carries plan_end onto paid_period_end. The only writer of that
-- column until now was the bulk CSV importer, so an owner could earmark a
-- plan during an import and never afterwards.
--
-- Two guards the importer doesn't have: the plan is checked against the
-- gym, and a row that has already been claimed is refused rather than
-- silently ignored — the trigger is AFTER INSERT on gym_memberships and
-- can never fire again for an account that exists, so writing an earmark
-- onto a linked row would look like it worked and do nothing at all.

create or replace function public.earmark_pending_member_plan(
  p_gym_id     uuid,
  p_pending_id uuid,
  p_plan_id    uuid,
  p_until      date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.membership_plans%rowtype;
  v_pending public.pending_members%rowtype;
  v_end     date;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;

  select * into v_plan
    from public.membership_plans
    where plan_id = p_plan_id
      and gym_id = p_gym_id
      and archived_at is null;
  if v_plan.plan_id is null then
    raise exception 'No such plan';
  end if;

  select * into v_pending
    from public.pending_members
    where id = p_pending_id
      and gym_id = p_gym_id;
  if v_pending.id is null then
    raise exception 'No such pending member';
  end if;
  if v_pending.status = 'linked' then
    raise exception 'Already joined';
  end if;

  -- Exclusive, matching assign_member_plan: apply_pending_member_data
  -- casts this date straight into paid_period_end, so storing the last day
  -- itself would lapse them at 03:30 on that day and quietly buy a pending
  -- member one day less than an existing one for the same sentence.
  v_end := case
    when p_until is not null then p_until + 1
    when v_plan.kind = 'credit_pack' then null
    when v_plan.period_length is not null
      then (now() + v_plan.period_length)::date + 1
    else (now() + interval '1 month')::date + 1
  end;

  update public.pending_members
    set linked_membership_plan_id = v_plan.plan_id,
        -- Overwrite rather than coalesce. An imported row already carries
        -- the old provider's free text here, and the whole point of an
        -- earmark is that the owner has decided it is wrong — leaving it
        -- would have the import list say "Legacy monthly" under a receipt
        -- saying Unlimited, and carry that string onto the membership at
        -- claim time.
        plan_name = v_plan.name,
        plan_end  = v_end
    where id = v_pending.id;

  return jsonb_build_object(
    'pending_id', v_pending.id,
    'email', v_pending.email,
    'plan_name', v_plan.name,
    'plan_kind', v_plan.kind,
    'price_cents', v_plan.monthly_price_cents,
    'runs_to', case when v_end is not null then v_end - 1 end
  );
end;
$$;

revoke execute on function public.earmark_pending_member_plan(uuid, uuid, uuid, date)
  from public, anon;
grant execute on function public.earmark_pending_member_plan(uuid, uuid, uuid, date)
  to authenticated;

-- ============================================================================
-- 3. grant_member_comp — comping, at last
-- ============================================================================
--
-- comp_grants has existed since 0009 and nothing in the app has ever
-- created one: the member list and profile display live grants, the
-- booking picker prefers them over plan subscriptions (0050:166-169), and
-- there is no way to issue one.
--
-- This also settles a disagreement rather than inheriting it. The
-- capability says owner + admin + coach (default_capability, 0169:67) but
-- the only enforcement that existed — comp_grants' own INSERT policy —
-- calls user_can_issue_comp_grant, whose body is raw role owner|coach
-- (0009:19-32). An admin with the capability ticked was refused by RLS.
-- Going through effective_can makes the capability mean what the Team
-- screen says it means.
--
-- A comp with no credit count is unmetered inside its window, which is
-- what "comp Sarah for a month" means. Passing p_credits makes it a
-- specific number of free classes instead.

create or replace function public.grant_member_comp(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_days       integer default 30,
  p_credits    integer default null,
  p_reason     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days    integer := coalesce(p_days, 30);
  v_ends_at timestamptz;
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_issue_comp_grant') then
    raise exception 'Not authorised';
  end if;
  if v_days < 1 or v_days > 366 then
    raise exception 'Comp window out of range';
  end if;
  if p_credits is not null and (p_credits < 1 or p_credits > 500) then
    raise exception 'Comp credits out of range';
  end if;

  -- The composite FK (gym_id, profile_id) -> gym_memberships means a
  -- non-member insert would fail on the constraint; refuse in words
  -- instead. left_at is null because comps survive soft removal and
  -- nothing restores them on rejoin.
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_profile_id and left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  v_ends_at := now() + make_interval(days => v_days);

  insert into public.comp_grants (
    gym_id, profile_id, starts_at, ends_at,
    credits_total, credits_remaining, granted_by, reason
  ) values (
    p_gym_id, p_profile_id, now(), v_ends_at,
    p_credits, p_credits, auth.uid(), p_reason
  )
  returning grant_id into v_id;

  return jsonb_build_object(
    'grant_id', v_id,
    'days', v_days,
    'credits', p_credits,
    'ends_at', v_ends_at
  );
end;
$$;

revoke execute on function public.grant_member_comp(uuid, uuid, integer, integer, text)
  from public, anon;
grant execute on function public.grant_member_comp(uuid, uuid, integer, integer, text)
  to authenticated;

commit;
