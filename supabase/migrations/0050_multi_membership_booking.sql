-- Phase 1a — multi-membership awareness on bookings.
--
-- Three things land here:
--
--   1. Track which entitlement (comp grant or plan subscription) a
--      booking was made against. class_bookings has been entitlement-
--      blind since 0006; the 0018 cancel path infers refund target
--      by precedence rule, which is right for the single-entitlement
--      case but wrong the moment a member holds two. New columns:
--      `used_entitlement_kind`, `used_entitlement_id`,
--      `booked_by_profile_id` (who actually clicked book — for the
--      coach-on-behalf path in 1b).
--
--   2. The default-picker honours `gyms.subscription_resolution`
--      (`credits_first` | `newest_first` | `highest_priority`). The
--      column landed in 0049 with `credits_first` preserving prior
--      behaviour; this migration is where it starts driving anything.
--      `highest_priority` reads a new `plan_subscriptions.priority`
--      column (default 0); ties break on created_at desc.
--
--   3. book_class + _book_class_for accept an optional explicit
--      entitlement choice. The member-side UI calls
--      list_booking_entitlements first; when the list has more than
--      one row it shows a picker and passes the result. When no
--      choice is supplied the default-picker fires (now reading the
--      gym setting). The chosen entitlement is persisted on the
--      booking row, which the refund path (0018) prefers over its
--      inference rule when present.
--
-- Auth gate split. The 0011 public select_default_entitlement
-- filters to no rows when the caller is neither the target nor staff
-- — fine for direct member/staff use, but _book_class_for is also
-- reached from the waitlist promotion trigger (0016) where auth.uid()
-- is the cancelling member, not the waiter. To keep the picker
-- working for promotions we extract an unchecked inner helper and
-- have _book_class_for call it; the public wrapper keeps the gate.

begin;

-- ============================================================================
-- 1. plan_subscriptions.priority for the highest_priority mode
-- ============================================================================

alter table public.plan_subscriptions
  add column if not exists priority integer not null default 0;

-- ============================================================================
-- 2. class_bookings: track the entitlement choice + who booked
-- ============================================================================

alter table public.class_bookings
  add column if not exists used_entitlement_kind text
    check (used_entitlement_kind is null
           or used_entitlement_kind in ('comp_grant', 'plan_subscription')),
  add column if not exists used_entitlement_id   uuid,
  add column if not exists booked_by_profile_id  uuid
    references public.profiles(id) on delete set null;

-- ============================================================================
-- 3. Unchecked picker + gated public wrapper
-- ============================================================================
--
-- The body that used to live in select_default_entitlement, sans the
-- auth_ok gate. _book_class_for calls this directly; the public
-- wrapper (next) adds the gate.

create or replace function public._select_default_entitlement_unchecked(
  p_profile_id       uuid,
  p_gym_id           uuid,
  p_class_session_id uuid
) returns table (kind public.entitlement_kind, id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
-- The RETURNS TABLE column `id` collides with table columns named id
-- inside the query body (gyms.id, eligible_plans.id, credit_pick.id).
-- Tell plpgsql the column always wins; the OUT name is only used as
-- the result schema, never as a value inside the body.
#variable_conflict use_column
declare
  v_mode text;
begin
  select coalesce(subscription_resolution, 'credits_first')
    into v_mode from public.gyms where id = p_gym_id;

  return query
  with cs as (
    select cs.id, cs.gym_id, cs.class_type_id, cs.starts_at
    from public.class_sessions cs
    where cs.id = p_class_session_id and cs.gym_id = p_gym_id
  ),
  eligible_comps as (
    select cg.grant_id, cg.ends_at
    from public.comp_grants cg, cs
    where cg.profile_id = p_profile_id
      and cg.gym_id = p_gym_id
      and cs.starts_at >= cg.starts_at
      and cs.starts_at <  cg.ends_at
      and cg.revoked_at is null
      and (cg.credits_total is null or cg.credits_remaining > 0)
      and (
        cardinality(cg.class_type_allowlist) = 0
        or cs.class_type_id = any(cg.class_type_allowlist)
      )
  ),
  comp_pick as (
    select grant_id from eligible_comps order by ends_at asc limit 1
  ),
  eligible_plans as (
    select ps.id, mp.kind as plan_kind, ps.paid_period_end,
           ps.priority, ps.created_at
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    cross join cs
    where ps.profile_id = p_profile_id
      and ps.gym_id     = p_gym_id
      and (
        ps.status = 'active'
        or (ps.status = 'cancelled_at_period_end'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
        or (ps.status = 'refunded_retained'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
      )
      and (
        mp.kind = 'unlimited'
        or coalesce(ps.credit_balance, 0) > 0
      )
      and (
        not exists (
          select 1 from public.plan_class_types pct where pct.plan_id = ps.plan_id
        )
        or exists (
          select 1 from public.plan_class_types pct
          where pct.plan_id = ps.plan_id and pct.class_type_id = cs.class_type_id
        )
      )
  ),
  -- Plan pick. credits_first keeps the bucket preference (credit-based
  -- before unlimited, then earliest paid_period_end inside the
  -- credit-based bucket). newest_first and highest_priority don't
  -- bucket — the user's setting says "use the newest / highest-
  -- priority plan", regardless of kind. created_at desc is always
  -- the last tie-break.
  plan_pick as (
    select id from eligible_plans
    order by
      case
        when v_mode = 'credits_first' and plan_kind = 'unlimited' then 1
        else 0
      end,
      case
        when v_mode = 'newest_first'     then -extract(epoch from created_at)
        when v_mode = 'highest_priority' then -priority::numeric
        when v_mode = 'credits_first'
             and plan_kind in ('credit_period', 'credit_pack')
          then extract(epoch from coalesce(paid_period_end, 'infinity'::timestamptz))
        else 0::numeric
      end,
      created_at desc
    limit 1
  )
  select 'comp_grant'::public.entitlement_kind, grant_id from comp_pick
  union all
  select 'plan_subscription'::public.entitlement_kind, id from plan_pick
    where not exists (select 1 from comp_pick);
end;
$$;

revoke execute on function
  public._select_default_entitlement_unchecked(uuid, uuid, uuid)
  from public, anon, authenticated;

-- Public wrapper. Same shape and behaviour as the 0011 version, just
-- now reads the gym's subscription_resolution via the inner helper.
-- DROP + CREATE because we're switching language sql → plpgsql.

drop function if exists public.select_default_entitlement(uuid, uuid, uuid);

create function public.select_default_entitlement(
  p_profile_id       uuid,
  p_gym_id           uuid,
  p_class_session_id uuid
) returns table (kind public.entitlement_kind, id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (p_profile_id = auth.uid() or public.user_can_assign_plan(p_gym_id)) then
    return;
  end if;
  return query
    select s.kind, s.id
    from public._select_default_entitlement_unchecked(
      p_profile_id, p_gym_id, p_class_session_id) s;
end;
$$;
grant execute on function public.select_default_entitlement(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- 3b. list_booking_entitlements: same id-shadowing fix
-- ============================================================================
--
-- The 0011 definition uses `where id = p_class_session_id` against
-- class_sessions inside a plpgsql body where `id` is also the RETURNS
-- TABLE column. That ambiguity was latent — no caller hit it until
-- _book_class_for started invoking the function to verify an explicit
-- entitlement choice. Same `#variable_conflict use_column` fix as the
-- picker.

create or replace function public.list_booking_entitlements(
  p_class_session_id   uuid,
  p_target_profile_id  uuid default null
) returns table (
  kind       public.entitlement_kind,
  id         uuid,
  is_default boolean,
  label      text
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_profile      uuid;
  v_gym          uuid;
  v_default_kind public.entitlement_kind;
  v_default_id   uuid;
begin
  v_profile := coalesce(p_target_profile_id, auth.uid());
  if v_profile is null then
    return;
  end if;

  select gym_id into v_gym from public.class_sessions where id = p_class_session_id;
  if v_gym is null then
    return;
  end if;

  if v_profile <> auth.uid() and not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised to view another member''s entitlements';
  end if;

  select s.kind, s.id into v_default_kind, v_default_id
  from public.select_default_entitlement(v_profile, v_gym, p_class_session_id) s;

  return query
    select
      'comp_grant'::public.entitlement_kind,
      cg.grant_id,
      (v_default_kind = 'comp_grant' and cg.grant_id = v_default_id),
      coalesce(cg.reason, 'Comp grant')::text
    from public.comp_grants cg
    join public.class_sessions cs on cs.id = p_class_session_id
    where cg.profile_id = v_profile
      and cg.gym_id     = v_gym
      and cs.starts_at >= cg.starts_at
      and cs.starts_at <  cg.ends_at
      and cg.revoked_at is null
      and (cg.credits_total is null or cg.credits_remaining > 0)
      and (
        cardinality(cg.class_type_allowlist) = 0
        or cs.class_type_id = any(cg.class_type_allowlist)
      )
    union all
    select
      'plan_subscription'::public.entitlement_kind,
      ps.id,
      (v_default_kind = 'plan_subscription' and ps.id = v_default_id),
      mp.name
    from public.plan_subscriptions ps
    join public.membership_plans mp on mp.plan_id = ps.plan_id
    join public.class_sessions cs on cs.id = p_class_session_id
    where ps.profile_id = v_profile
      and ps.gym_id     = v_gym
      and (
        ps.status = 'active'
        or (ps.status = 'cancelled_at_period_end'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
        or (ps.status = 'refunded_retained'
            and ps.paid_period_end is not null
            and cs.starts_at <= ps.paid_period_end)
      )
      and (
        mp.kind = 'unlimited'
        or coalesce(ps.credit_balance, 0) > 0
      )
      and (
        not exists (
          select 1 from public.plan_class_types pct where pct.plan_id = ps.plan_id
        )
        or exists (
          select 1 from public.plan_class_types pct
          where pct.plan_id = ps.plan_id and pct.class_type_id = cs.class_type_id
        )
      );
end;
$$;
grant execute on function public.list_booking_entitlements(uuid, uuid) to authenticated;

-- ============================================================================
-- 4. _book_class_for accepts the picker's choice + persists it
-- ============================================================================
--
-- New signature drops two optional kind/id args at the end, plus a
-- booked_by_profile_id arg so the caller decides attribution. When
-- both entitlement args are supplied we verify the picked entitlement
-- is genuinely eligible via list_booking_entitlements; when not, we
-- fall back to the unchecked picker. The booking row stores whichever
-- was used, so the cancel-refund path in 0018 can target it precisely.
--
-- booked_by_profile_id semantics:
--   - book_class (member self-book) → auth.uid()  (= the member)
--   - waitlist promotion trigger    → null        (system did it)
--   - phase 1b staff_book_member    → auth.uid()  (= the coach)

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

  -- Entitlement resolution. Explicit choice → verify it's listed as
  -- eligible by list_booking_entitlements; implicit → ask the picker
  -- (unchecked, since _book_class_for is itself gated by the
  -- membership check above and the wrapper that called us).
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

  return v_booking_id;
end;
$$;

revoke execute on function
  public._book_class_for(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;

-- Old 2-arg form is no longer the resolution target — the new 5-arg
-- form covers the same calls via defaults. Drop explicitly to avoid
-- ambiguous overload resolution on (uuid, uuid).

drop function if exists public._book_class_for(uuid, uuid);

-- ============================================================================
-- 5. book_class accepts the same optional choice + records the booker
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
    session_id, v_uid, p_entitlement_kind, p_entitlement_id, v_uid);
  return v_booking_id;
end;
$$;
grant execute on function public.book_class(uuid, text, uuid) to authenticated;

-- Drop the old single-arg form so the new 3-arg form is the only
-- overload — clients re-codegen and pick it up.

drop function if exists public.book_class(uuid);

-- ============================================================================
-- 6. Refund: prefer the stored pointer when present
-- ============================================================================

create or replace function public._refund_booking_credit(
  p_session_id uuid,
  p_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id        uuid;
  v_starts_at     timestamptz;
  v_class_type_id uuid;
  v_grant_id      uuid;
  v_sub_id        uuid;
  v_kind          text;
  v_id            uuid;
begin
  select gym_id, starts_at, class_type_id
    into v_gym_id, v_starts_at, v_class_type_id
    from public.class_sessions
    where id = p_session_id;
  if v_gym_id is null then
    return;
  end if;

  -- Prefer the explicit pointer set at book time (0050). When absent
  -- — e.g. legacy bookings from before this migration — fall back to
  -- the inference rule 0018 documented.
  select used_entitlement_kind, used_entitlement_id
    into v_kind, v_id
    from public.class_bookings
    where class_session_id = p_session_id and profile_id = p_profile_id;

  if v_kind = 'comp_grant' and v_id is not null then
    update public.comp_grants
      set credits_remaining = credits_remaining + 1
      where grant_id = v_id
        and credits_remaining is not null;
    return;
  end if;

  if v_kind = 'plan_subscription' and v_id is not null then
    update public.plan_subscriptions ps
      set credit_balance = credit_balance + 1
      from public.membership_plans mp
      where mp.plan_id = ps.plan_id
        and ps.id = v_id
        and ps.credit_balance is not null
        and mp.kind in ('credit_pack', 'credit_period');
    return;
  end if;

  -- ── Legacy inference path (0018) ────────────────────────────────
  select grant_id into v_grant_id
    from public.comp_grants
    where profile_id = p_profile_id
      and gym_id     = v_gym_id
      and revoked_at is null
      and credits_remaining is not null
      and credits_total     is not null
      and starts_at <= v_starts_at
      and ends_at   >  v_starts_at
      and (
        cardinality(class_type_allowlist) = 0
        or v_class_type_id = any(class_type_allowlist)
      )
    order by ends_at
    limit 1;
  if v_grant_id is not null then
    update public.comp_grants
      set credits_remaining = credits_remaining + 1
      where grant_id = v_grant_id;
    return;
  end if;

  select ps.id into v_sub_id
    from public.plan_subscriptions ps
    join public.membership_plans   mp on mp.plan_id = ps.plan_id
    where ps.profile_id = p_profile_id
      and ps.gym_id     = v_gym_id
      and ps.status     = 'active'::public.plan_sub_state
      and ps.credit_balance is not null
      and mp.kind in ('credit_pack', 'credit_period')
    limit 1;
  if v_sub_id is not null then
    update public.plan_subscriptions
      set credit_balance = credit_balance + 1
      where id = v_sub_id;
  end if;
end;
$$;

revoke execute on function public._refund_booking_credit(uuid, uuid)
  from public, anon, authenticated;

commit;
