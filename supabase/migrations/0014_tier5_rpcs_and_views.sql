-- Phase 2 Tier 5: cohort view + RPCs.
--
-- v_member_cohort is the single source of truth for cohort flags.
-- Insights tiles, CSV exports, and tag-rule matching all read from
-- it; the on-screen number cannot drift from the export.
--
-- Pre-Stripe: billing_events is empty, so has_ever_paid is
-- structurally false. is_paying and conversion counts read zero
-- until Stripe ships. The insights screen gates the Paying +
-- Conversion tiles on the billing_live flag returned by
-- compute_insight_summary.
--
-- Inline actor + timestamp columns (attended_at / marked_by / no_show_*
-- on class_bookings, claimed_by / claimed_at on cover_request_sessions,
-- created_by on member_tags, updated_by on gym_insight_targets) carry
-- the operator-action record until audit_events lands in Phase 4. The
-- Phase 4 trigger will mirror these into audit_events; inline columns
-- remain the system of record.

-- ============================================================================
-- 1. v_member_cohort — one row per (gym × member) for "today"
-- ============================================================================

-- security_invoker = on (PG 15+) so RLS on the underlying tables
-- applies. PG 17 here per supabase/config.toml.

create or replace view public.v_member_cohort
with (security_invoker = on)
as
with cohort as (
  select
    gm.gym_id,
    gm.profile_id,
    gm.created_at as joined_at,
    public.has_ever_paid(gm.profile_id, gm.gym_id)         as is_paying,
    public.is_active_relationship(gm.profile_id, gm.gym_id) as is_active,
    (
      select min(extract(day from (ps.paid_period_end - now())))::integer
      from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
        and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
        and ps.paid_period_end is not null
        and ps.paid_period_end > now()
    ) as plan_days_until_expiry,
    (
      select min(extract(day from (cg.ends_at - now())))::integer
      from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and cg.ends_at > now()
    ) as comp_days_until_expiry,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
        and cg.revoked_at is null
        and now() >= cg.starts_at
        and now() <  cg.ends_at
    ) as has_live_comp,
    exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = gm.profile_id
        and ps.gym_id     = gm.gym_id
    ) as ever_had_plan,
    exists (
      select 1 from public.comp_grants cg
      where cg.profile_id = gm.profile_id
        and cg.gym_id     = gm.gym_id
    ) as ever_had_comp
  from public.gym_memberships gm
  where gm.role = 'member'
)
select
  c.gym_id,
  c.profile_id,
  c.joined_at,
  (c.has_live_comp and not c.is_paying)             as is_intro,
  c.is_paying,
  c.is_active,
  least(c.plan_days_until_expiry, c.comp_days_until_expiry) as days_until_expiry,
  (
    least(c.plan_days_until_expiry, c.comp_days_until_expiry) is not null
    and least(c.plan_days_until_expiry, c.comp_days_until_expiry) between 0 and 7
  ) as is_expiring_soon,
  (
    not c.is_active
    and (c.ever_had_plan or c.ever_had_comp)
  ) as is_expired
from cohort c;

grant select on public.v_member_cohort to authenticated;

-- ============================================================================
-- 2. apply_tag_rules — idempotent rule materialisation
-- ============================================================================

create or replace function public.apply_tag_rules(p_gym_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total      integer := 0;
  v_loop_count integer;
  v_rule       public.tag_rules%rowtype;
  v_uid        uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  delete from public.member_tags
    where gym_id = p_gym_id and source = 'auto';

  for v_rule in
    select * from public.tag_rules
    where gym_id = p_gym_id and active = true
  loop
    insert into public.member_tags
      (gym_id, profile_id, label, color, source, rule_id, created_by)
    select
      v_rule.gym_id, c.profile_id, v_rule.label, v_rule.color, 'auto', v_rule.id, v_uid
    from public.v_member_cohort c
    where c.gym_id = p_gym_id
      and case v_rule.predicate_kind
        when 'intro'         then c.is_intro
        when 'expiring_soon' then c.days_until_expiry is not null
                                  and c.days_until_expiry <= coalesce(v_rule.threshold_days, 7)
        when 'expired'       then c.is_expired
        when 'paying'        then c.is_paying
        when 'inactive'      then not c.is_active
        when 'never_paid'    then not c.is_paying
        else false
      end
    on conflict (gym_id, profile_id, label) do nothing;

    get diagnostics v_loop_count = row_count;
    v_total := v_total + v_loop_count;
  end loop;

  return v_total;
end;
$$;

grant execute on function public.apply_tag_rules(uuid) to authenticated;

-- ============================================================================
-- 3. check_in_member / mark_no_show
-- ============================================================================

create or replace function public.check_in_member(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.class_bookings;
  v_session public.class_sessions;
  v_uid     uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_booking from public.class_bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'Booking not found';
  end if;
  if not public.user_can_access_staff_area(v_booking.gym_id) then
    raise exception 'Not authorised';
  end if;

  -- Strict no-op when already attended (matches check_in_idempotent.sql).
  if v_booking.attended_at is not null and v_booking.no_show = false then
    return;
  end if;

  select * into v_session from public.class_sessions where id = v_booking.class_session_id;
  if v_session is null then
    raise exception 'Class session not found';
  end if;
  if now() < v_session.starts_at - interval '15 minutes' then
    raise exception 'Check-in not yet open for this class';
  end if;

  update public.class_bookings
    set attended_at       = now(),
        marked_by         = v_uid,
        no_show           = false,
        no_show_marked_at = null
    where id = p_booking_id;
end;
$$;

grant execute on function public.check_in_member(uuid) to authenticated;

create or replace function public.mark_no_show(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.class_bookings;
  v_uid     uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_booking from public.class_bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'Booking not found';
  end if;
  if not public.user_can_access_staff_area(v_booking.gym_id) then
    raise exception 'Not authorised';
  end if;

  if v_booking.no_show = true then
    return;
  end if;

  update public.class_bookings
    set no_show           = true,
        no_show_marked_at = now(),
        marked_by         = v_uid,
        attended_at       = null
    where id = p_booking_id;
end;
$$;

grant execute on function public.mark_no_show(uuid) to authenticated;

-- ============================================================================
-- 4. request_cover / claim_cover / cancel_cover_request
-- ============================================================================

create or replace function public.request_cover(
  p_session_ids uuid[],
  p_notes       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_gym_id       uuid;
  v_request_id   uuid;
  v_range_start  timestamptz;
  v_range_end    timestamptz;
  v_session_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'No sessions selected';
  end if;

  -- All sessions must belong to the caller, all in the same gym.
  with sess as (
    select cs.id, cs.gym_id, cs.coach_id, cs.starts_at, cs.duration_minutes
    from public.class_sessions cs
    where cs.id = any(p_session_ids)
  )
  select
    min(gym_id), min(starts_at), max(starts_at + (duration_minutes || ' minutes')::interval),
    count(*) filter (where coach_id = v_uid)
  into v_gym_id, v_range_start, v_range_end, v_session_count
  from sess;

  if v_session_count is null or v_session_count <> cardinality(p_session_ids) then
    raise exception 'Can only request cover for classes you coach';
  end if;
  if not public.user_can_cover(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, notes)
  values
    (v_gym_id, v_uid, v_range_start, v_range_end, p_notes)
  returning id into v_request_id;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  select v_request_id, sid, v_uid, v_gym_id
  from unnest(p_session_ids) as sid;

  return v_request_id;
end;
$$;

grant execute on function public.request_cover(uuid[], text) to authenticated;

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

grant execute on function public.claim_cover(uuid) to authenticated;

create or replace function public.cancel_cover_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_request public.cover_requests;
  v_claimed integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_request from public.cover_requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Cover request not found';
  end if;
  if v_request.requested_by <> v_uid and not public.user_can_admin(v_request.gym_id) then
    raise exception 'Not authorised';
  end if;
  if v_request.status <> 'open' then
    raise exception 'Cover request cannot be cancelled in state %', v_request.status;
  end if;

  select count(*) into v_claimed
    from public.cover_request_sessions
    where request_id = p_request_id and claimed_by is not null;
  if v_claimed > 0 then
    raise exception 'Some offers have already been claimed';
  end if;

  delete from public.cover_request_sessions where request_id = p_request_id;
  update public.cover_requests
    set status = 'cancelled', cancelled_at = now()
    where id = p_request_id;
end;
$$;

grant execute on function public.cancel_cover_request(uuid) to authenticated;

-- ============================================================================
-- 5. complete_task / reopen_task
-- ============================================================================

create or replace function public.complete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_task public.coach_tasks;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.coach_tasks where id = p_task_id;
  if v_task is null then
    raise exception 'Task not found';
  end if;
  if v_task.assigned_to <> v_uid and not public.user_can_admin_or_coach(v_task.gym_id) then
    raise exception 'Not authorised';
  end if;

  if v_task.status = 'done' then
    return;
  end if;

  update public.coach_tasks
    set status = 'done', completed_at = now()
    where id = p_task_id;
end;
$$;

grant execute on function public.complete_task(uuid) to authenticated;

create or replace function public.reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_task public.coach_tasks;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.coach_tasks where id = p_task_id;
  if v_task is null then
    raise exception 'Task not found';
  end if;
  if v_task.assigned_to <> v_uid and not public.user_can_admin_or_coach(v_task.gym_id) then
    raise exception 'Not authorised';
  end if;

  if v_task.status = 'open' then
    return;
  end if;

  update public.coach_tasks
    set status = 'open', completed_at = null
    where id = p_task_id;
end;
$$;

grant execute on function public.reopen_task(uuid) to authenticated;

-- ============================================================================
-- 6. compute_insight_summary
-- ============================================================================

create or replace function public.compute_insight_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  intros_new         integer,
  intros_target      integer,
  conversions        integer,
  conversions_target integer,
  expiring_soon      integer,
  expired            integer,
  paying_now         integer,
  billing_live       boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;

  return query
  with cohort as (
    select * from public.v_member_cohort where gym_id = p_gym_id
  ),
  conv as (
    -- conversions: count of members whose first paying billing_event
    -- in this gym fell inside the requested period. Pre-Stripe this
    -- is structurally zero (no rows in billing_events).
    select count(distinct be.member_id) as n
    from public.billing_events be
    where be.gym_id = p_gym_id
      and be.kind in ('charge.succeeded', 'invoice.paid')
      and be.occurred_at::date between p_period_start and p_period_end
      and not exists (
        select 1 from public.billing_events be2
        where be2.gym_id = p_gym_id
          and be2.member_id = be.member_id
          and be2.kind in ('charge.succeeded', 'invoice.paid')
          and be2.occurred_at < be.occurred_at
      )
  ),
  targets as (
    select metric, target_value from public.gym_insight_targets
    where gym_id = p_gym_id
      and period = case
        when p_period_end - p_period_start <= 31 then 'month'
        else 'quarter'
      end
  )
  select
    (select count(*)::int from cohort
      where is_intro
        and joined_at::date between p_period_start and p_period_end),
    coalesce((select target_value from targets where metric = 'intros_new'), 0),
    (select coalesce(n, 0)::int from conv),
    coalesce((select target_value from targets where metric = 'conversions'), 0),
    (select count(*)::int from cohort where is_expiring_soon),
    (select count(*)::int from cohort where is_expired),
    (select count(*)::int from cohort where is_paying),
    exists(select 1 from public.billing_events where gym_id = p_gym_id);
end;
$$;

grant execute on function public.compute_insight_summary(uuid, date, date) to authenticated;

-- ============================================================================
-- 7. create_invite
-- ============================================================================

create or replace function public.create_invite(
  p_gym_id     uuid,
  p_role       public.gym_role,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_is_owner  boolean;
  v_code      text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  v_is_owner := public.user_is_owner_of(p_gym_id);

  -- Privilege ladder: admins cannot mint admins or owners.
  if not v_is_owner and p_role in ('owner', 'admin') then
    raise exception 'Only owners can invite owners or admins';
  end if;

  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  insert into public.invite_codes
    (gym_id, code, role, created_by, expires_at)
  values
    (p_gym_id, v_code, p_role, v_uid, p_expires_at);

  return v_code;
end;
$$;

grant execute on function public.create_invite(uuid, public.gym_role, timestamptz) to authenticated;
