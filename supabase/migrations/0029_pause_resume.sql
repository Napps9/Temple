-- Phase 1 / Track B: pause + resume RPCs.
--
-- Pause holds pre-paid time and stops further charges; resume hands
-- the held time back and restarts billing where it left off.
-- Eligibility is computed at class start (see 0011) so a paused
-- member cannot attend classes booked before the pause, matching
-- the spec invariant that "money paid and access granted never
-- drift".
--
-- Initiator policy:
--   Staff (Owner / Coach / Staff via user_can_assign_plan): always.
--   Member self-pause: only when gyms.member_can_pause is true. The
--     spec defaults this off ("members should not self-pause unless
--     explicitly enabled").
--
-- This RPC writes DB state. The wrapping edge function (Sprint 3
-- follow-up) tells Stripe via subscriptions.update with
-- pause_collection on pause, and clears it on resume.

-- ============================================================================
-- 1. gyms.member_can_pause (default false per spec)
-- ============================================================================

alter table public.gyms
  add column member_can_pause boolean not null default false;

-- ============================================================================
-- 2. plan_subscriptions.pause_started_at + pause_ends_at
--    pause_started_at is when the pause took effect (set on pause,
--    cleared on resume). pause_ends_at is the optional staff-set
--    auto-resume date — NULL means indefinite.
-- ============================================================================

alter table public.plan_subscriptions
  add column pause_started_at timestamptz,
  add column pause_ends_at    timestamptz;

-- ============================================================================
-- 3. compute_resumed_paid_period_end — SQL mirror of pause-math.ts
-- ============================================================================

create or replace function public.compute_resumed_paid_period_end(
  p_paid_period_end   timestamptz,
  p_pause_started_at  timestamptz,
  p_resume_at         timestamptz
) returns timestamptz
language sql
immutable
as $$
  select case
    when p_paid_period_end is null     then null
    when p_pause_started_at is null    then p_paid_period_end
    when p_resume_at <= p_pause_started_at then p_paid_period_end
    else p_paid_period_end + (p_resume_at - p_pause_started_at)
  end;
$$;

-- ============================================================================
-- 4. pause_subscription
-- ============================================================================

create or replace function public.pause_subscription(
  p_plan_subscription_id uuid,
  p_pause_ends_at        timestamptz default null
) returns table (
  new_status        public.plan_sub_state,
  pause_started_at  timestamptz,
  pause_ends_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub              public.plan_subscriptions;
  v_actor            uuid := auth.uid();
  v_member_can_pause boolean;
  v_now              timestamptz := now();
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sub
  from public.plan_subscriptions
  where id = p_plan_subscription_id;

  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;

  if v_sub.status <> 'active' then
    raise exception 'Cannot pause subscription in status %', v_sub.status;
  end if;

  if v_sub.profile_id <> v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    raise exception 'Not authorised to pause this subscription';
  end if;

  -- Self-pause requires gym opt-in.
  if v_sub.profile_id = v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    select member_can_pause into v_member_can_pause
    from public.gyms where id = v_sub.gym_id;
    if not coalesce(v_member_can_pause, false) then
      raise exception 'This gym does not allow member-initiated pause';
    end if;
  end if;

  if p_pause_ends_at is not null and p_pause_ends_at <= v_now then
    raise exception 'pause_ends_at must be in the future';
  end if;

  update public.plan_subscriptions
  set status            = 'paused',
      pause_started_at  = v_now,
      pause_ends_at     = p_pause_ends_at
  where id = v_sub.id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_sub.gym_id,
    v_actor,
    'plan_subscription',
    v_sub.id,
    'plan_sub_paused',
    jsonb_build_object(
      'pause_started_at',  v_now,
      'pause_ends_at',     p_pause_ends_at,
      'self_initiated',    v_sub.profile_id = v_actor
    )
  );

  return query select 'paused'::public.plan_sub_state, v_now, p_pause_ends_at;
end;
$$;

grant execute on function public.pause_subscription(uuid, timestamptz) to authenticated;

-- ============================================================================
-- 5. resume_subscription
--    paid_period_end shifts forward by exactly the time the sub
--    spent paused. The wrapping edge function updates Stripe with
--    subscriptions.update({ pause_collection: '' }) and adjusts
--    cancel_at if any was set.
-- ============================================================================

create or replace function public.resume_subscription(
  p_plan_subscription_id uuid
) returns table (
  new_status              public.plan_sub_state,
  new_paid_period_end     timestamptz,
  pause_duration_seconds  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub        public.plan_subscriptions;
  v_actor      uuid := auth.uid();
  v_now        timestamptz := now();
  v_new_end    timestamptz;
  v_duration_s integer;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sub
  from public.plan_subscriptions
  where id = p_plan_subscription_id;

  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;

  if v_sub.status <> 'paused' then
    raise exception 'Cannot resume subscription in status %', v_sub.status;
  end if;

  if v_sub.profile_id <> v_actor
     and not public.user_can_assign_plan(v_sub.gym_id) then
    raise exception 'Not authorised to resume this subscription';
  end if;

  v_new_end := public.compute_resumed_paid_period_end(
    v_sub.paid_period_end,
    v_sub.pause_started_at,
    v_now
  );

  v_duration_s := case
    when v_sub.pause_started_at is null then 0
    else greatest(0, extract(epoch from (v_now - v_sub.pause_started_at))::integer)
  end;

  update public.plan_subscriptions
  set status            = 'active',
      paid_period_end   = v_new_end,
      pause_started_at  = null,
      pause_ends_at     = null
  where id = v_sub.id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_sub.gym_id,
    v_actor,
    'plan_subscription',
    v_sub.id,
    'plan_sub_resumed',
    jsonb_build_object(
      'paused_at',              v_sub.pause_started_at,
      'resumed_at',             v_now,
      'pause_duration_seconds', v_duration_s,
      'new_paid_period_end',    v_new_end,
      'self_initiated',         v_sub.profile_id = v_actor
    )
  );

  return query select 'active'::public.plan_sub_state, v_new_end, v_duration_s;
end;
$$;

grant execute on function public.resume_subscription(uuid) to authenticated;
