-- Phase 3 Tier 6: archive / restore / hard-delete RPCs, the
-- member-removal flow (leave_gym), avatar URL setter,
-- copy_week_forward, and the non-health onboarding_responses table.
--
-- Capability gates:
--   archive_*                 user_can_admin_or_coach (classes)
--                             user_is_owner_of (plans)
--   restore_*                 same as archive
--   delete_*                  user_is_owner_of (owner-only by policy
--                             because hard delete is irreversible)
--   leave_gym / rejoin_gym    user_can_admin OR self
--   set_avatar_url            self only
--   copy_week_forward         user_can_admin_or_coach
--
-- leave_gym additionally cancels active subs/comps (via the inverted
-- enumeration on plan_subscriptions, and revoked_at on comp_grants),
-- deletes future bookings (firing the waitlist promotion trigger per
-- booking), and prunes the member's own waitlist entries so they
-- don't show up as ghost rows in waitlist_for_session.

-- ============================================================================
-- 1. Archive / restore / hard-delete: class_types
-- ============================================================================

create or replace function public.archive_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.user_can_admin_or_coach(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.class_types
    set archived_at = now()
    where id = p_id and archived_at is null;
end;
$$;
grant execute on function public.archive_class_type(uuid) to authenticated;

create or replace function public.restore_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.user_can_admin_or_coach(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.class_types set archived_at = null where id = p_id;
end;
$$;
grant execute on function public.restore_class_type(uuid) to authenticated;

create or replace function public.delete_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.user_is_owner_of(v_gym) then
    raise exception 'Not authorised';
  end if;
  if public.class_type_has_dependents(p_id) then
    raise exception 'Cannot delete: class type still has sessions, recurrences, programming or plan allowlist entries. Archive instead.';
  end if;
  delete from public.class_types where id = p_id;
end;
$$;
grant execute on function public.delete_class_type(uuid) to authenticated;

-- ============================================================================
-- 2. Archive / restore / hard-delete: membership_plans
-- ============================================================================

create or replace function public.archive_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.user_is_owner_of(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.membership_plans
    set archived_at = now()
    where plan_id = p_plan_id and archived_at is null;
end;
$$;
grant execute on function public.archive_plan(uuid) to authenticated;

create or replace function public.restore_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.user_is_owner_of(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.membership_plans
    set archived_at = null
    where plan_id = p_plan_id;
end;
$$;
grant execute on function public.restore_plan(uuid) to authenticated;

create or replace function public.delete_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.user_is_owner_of(v_gym) then
    raise exception 'Not authorised';
  end if;
  if public.plan_has_dependents(p_plan_id) then
    raise exception 'Cannot delete: plan still has subscriptions. Archive instead.';
  end if;
  delete from public.membership_plans where plan_id = p_plan_id;
end;
$$;
grant execute on function public.delete_plan(uuid) to authenticated;

-- ============================================================================
-- 3. leave_gym / rejoin_gym
-- ============================================================================
-- The single column flip on gym_memberships.left_at is what closes
-- the door across is_active_relationship, is_booking_eligible, and
-- the waitlist promotion trigger. The accompanying updates make sure
-- the entitlement layer agrees with the predicate (sub status moves
-- to cancelled; comp grants are revoked; future bookings deleted;
-- waitlist entries pruned so they don't show up as ghosts in
-- waitlist_for_session).
--
-- rejoin_gym ONLY clears left_at. It does NOT re-activate the
-- cancelled subs/comps — re-subscribing is a deliberate billing
-- event, not an undo.

create or replace function public.leave_gym(p_gym_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_profile_id and not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  update public.gym_memberships
    set left_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;

  delete from public.class_bookings
    where profile_id = p_profile_id
      and class_session_id in (
        select id from public.class_sessions
        where gym_id = p_gym_id and starts_at > now()
      );

  update public.plan_subscriptions
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and not public.is_terminal_subscription_status(status);

  update public.comp_grants
    set revoked_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and revoked_at is null;

  delete from public.class_waitlist
    where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;
grant execute on function public.leave_gym(uuid, uuid) to authenticated;

create or replace function public.rejoin_gym(p_gym_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_profile_id and not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  update public.gym_memberships
    set left_at = null
    where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;
grant execute on function public.rejoin_gym(uuid, uuid) to authenticated;

-- ============================================================================
-- 4. set_avatar_url — caller's own profile only
-- ============================================================================

create or replace function public.set_avatar_url(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set avatar_url = p_url where id = v_uid;
end;
$$;
grant execute on function public.set_avatar_url(text) to authenticated;

-- ============================================================================
-- 5. copy_week_forward — materialise next week's sessions
-- ============================================================================
-- Owner / admin / coach (matches can_edit_classes). Wraps
-- extend_recurrence to advance materialisation through the week
-- starting (p_from + 7 days). Mirrors extend_recurrence's active /
-- end-date semantics: extend_recurrence honors ends_on (via
-- least(until_date, coalesce(rec.ends_on, until_date))), so ended
-- recurrences are not resurrected.

create or replace function public.copy_week_forward(p_gym_id uuid, p_from date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_end date := p_from + interval '13 days';
  v_count int := 0;
  v_rec record;
  v_before int;
  v_after int;
begin
  if not public.user_can_admin_or_coach(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  for v_rec in
    select id from public.class_recurrences
    where gym_id = p_gym_id
      and (ends_on is null or ends_on >= p_from + interval '7 days')
  loop
    select count(*) into v_before from public.class_sessions
      where recurrence_id = v_rec.id
        and starts_at::date between p_from + 7 and v_target_end;
    perform public.extend_recurrence(v_rec.id, v_target_end);
    select count(*) into v_after from public.class_sessions
      where recurrence_id = v_rec.id
        and starts_at::date between p_from + 7 and v_target_end;
    v_count := v_count + (v_after - v_before);
  end loop;

  return v_count;
end;
$$;
grant execute on function public.copy_week_forward(uuid, date) to authenticated;

-- ============================================================================
-- 6. onboarding_responses — non-health (PAR-Q / health stays parked
--    behind Phase 4 GDPR controls)
-- ============================================================================
-- Display order lives on the row (display_order int). question_text
-- is snapshotted at answer time so later edits to the question
-- library don't rewrite history.

create table public.onboarding_responses (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  question_key    text not null,
  question_text   text not null,
  answer          text not null,
  display_order   int  not null,
  answered_at     timestamptz not null default now(),
  unique (gym_id, profile_id, question_key),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index onboarding_responses_member_order_idx
  on public.onboarding_responses(gym_id, profile_id, display_order);

alter table public.onboarding_responses enable row level security;

create policy onboarding_responses_self_or_staff_select on public.onboarding_responses
  for select using (
    profile_id = auth.uid()
    or public.user_can_access_staff_area(gym_id)
  );

create policy onboarding_responses_self_or_staff_insert on public.onboarding_responses
  for insert with check (
    profile_id = auth.uid()
    or public.user_can_admin_or_coach(gym_id)
  );

create policy onboarding_responses_self_or_staff_update on public.onboarding_responses
  for update using (
    profile_id = auth.uid()
    or public.user_can_admin_or_coach(gym_id)
  )
  with check (
    profile_id = auth.uid()
    or public.user_can_admin_or_coach(gym_id)
  );

create policy onboarding_responses_admin_delete on public.onboarding_responses
  for delete using (public.user_can_admin(gym_id));
