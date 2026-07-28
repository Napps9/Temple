-- Auto-tag rules that can see classes and memberships, applied nightly.
--
-- The original six predicate kinds (0013/0014) only read the cohort
-- view, so a gym could not express the tags it actually wants: "booked
-- an intro session", "attended a Yoga class this month", "on the
-- 6-month plan", "gave notice", "new this week", "not been in for a
-- month". This migration:
--
--   1. Adds six predicate kinds driven by class types, bookings,
--      attendance and plan subscriptions, with two config columns
--      (class_type_id, plan_id) whose presence is tied to the kind by
--      a CHECK — a rule can never point at a class type it doesn't use.
--   2. Re-points the tag write policies from user_can_admin to
--      effective_can('can_manage_tags'), so per-gym capability
--      overrides (0020) actually govern tagging the way the UI gate
--      already claims they do. Defaults are unchanged (owner + admin).
--   3. Splits rule materialisation into _apply_tag_rules (not client
--      callable) so a nightly pg_cron sweep can share it with the
--      existing apply_tag_rules RPC. Until now auto tags only moved
--      when someone pressed "Recompute now"; a rule like "expiring
--      soon" is only honest if it re-evaluates on its own.
--
-- Window semantics: booked_class_type deliberately counts FUTURE
-- sessions (the point of "booked an intro" is to act before it
-- happens); its threshold_days only bounds how far back past sessions
-- count. attended_class_type windows on the check-in time, and
-- no_recent_attendance / joined_within require a window to mean
-- anything, enforced by the CHECK.

begin;

-- ============================================================================
-- 1. Rule config columns + expanded predicate kinds
-- ============================================================================

alter table public.tag_rules
  add column class_type_id uuid references public.class_types(id) on delete cascade,
  add column plan_id       uuid references public.membership_plans(plan_id) on delete cascade;

create index tag_rules_class_type_idx on public.tag_rules(class_type_id)
  where class_type_id is not null;
create index tag_rules_plan_idx on public.tag_rules(plan_id)
  where plan_id is not null;

alter table public.tag_rules
  drop constraint tag_rules_predicate_kind_check;

alter table public.tag_rules
  add constraint tag_rules_predicate_kind_check check (predicate_kind in (
    'intro', 'expiring_soon', 'expired', 'paying', 'inactive', 'never_paid',
    'booked_class_type', 'attended_class_type', 'no_recent_attendance',
    'on_plan', 'cancelling', 'joined_within'
  ));

alter table public.tag_rules
  add constraint tag_rules_config_matches_kind check (
    (class_type_id is not null)
      = (predicate_kind in ('booked_class_type', 'attended_class_type'))
    and (plan_id is not null) = (predicate_kind = 'on_plan')
    and (predicate_kind not in ('no_recent_attendance', 'joined_within')
         or threshold_days is not null)
  );

-- ============================================================================
-- 2. Tag writes follow the capability, not the raw role
-- ============================================================================

drop policy tag_rules_admin_insert on public.tag_rules;
drop policy tag_rules_admin_update on public.tag_rules;
drop policy tag_rules_admin_delete on public.tag_rules;

create policy tag_rules_manage_insert on public.tag_rules
  for insert with check (public.effective_can(gym_id, 'can_manage_tags'));
create policy tag_rules_manage_update on public.tag_rules
  for update using (public.effective_can(gym_id, 'can_manage_tags'))
  with check (public.effective_can(gym_id, 'can_manage_tags'));
create policy tag_rules_manage_delete on public.tag_rules
  for delete using (public.effective_can(gym_id, 'can_manage_tags'));

drop policy member_tags_admin_insert on public.member_tags;
drop policy member_tags_admin_update on public.member_tags;
drop policy member_tags_admin_delete on public.member_tags;

create policy member_tags_manage_insert on public.member_tags
  for insert with check (public.effective_can(gym_id, 'can_manage_tags'));
create policy member_tags_manage_update on public.member_tags
  for update using (public.effective_can(gym_id, 'can_manage_tags'))
  with check (public.effective_can(gym_id, 'can_manage_tags'));
create policy member_tags_manage_delete on public.member_tags
  for delete using (public.effective_can(gym_id, 'can_manage_tags'));

-- ============================================================================
-- 3. _apply_tag_rules — shared materialisation, no client grant
-- ============================================================================
--
-- p_actor is the created_by for the tags this run writes; the nightly
-- sweep passes null and each tag falls back to its rule's author, so
-- the not-null FK holds without inventing a system profile.

create function public._apply_tag_rules(p_gym_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total      integer := 0;
  v_loop_count integer;
  v_rule       public.tag_rules%rowtype;
begin
  delete from public.member_tags
    where gym_id = p_gym_id and source = 'auto';

  for v_rule in
    select * from public.tag_rules
    where gym_id = p_gym_id and active = true
  loop
    insert into public.member_tags
      (gym_id, profile_id, label, color, source, rule_id, created_by)
    select
      v_rule.gym_id, c.profile_id, v_rule.label, v_rule.color, 'auto',
      v_rule.id, coalesce(p_actor, v_rule.created_by)
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
        when 'booked_class_type' then exists (
          select 1
          from public.class_bookings cb
          join public.class_sessions cs on cs.id = cb.class_session_id
          where cb.gym_id = p_gym_id
            and cb.profile_id = c.profile_id
            and cs.class_type_id = v_rule.class_type_id
            and (v_rule.threshold_days is null
                 or cs.starts_at >= now() - make_interval(days => v_rule.threshold_days))
        )
        when 'attended_class_type' then exists (
          select 1
          from public.class_bookings cb
          join public.class_sessions cs on cs.id = cb.class_session_id
          where cb.gym_id = p_gym_id
            and cb.profile_id = c.profile_id
            and cs.class_type_id = v_rule.class_type_id
            and cb.attended_at is not null
            and (v_rule.threshold_days is null
                 or cb.attended_at >= now() - make_interval(days => v_rule.threshold_days))
        )
        when 'no_recent_attendance' then not exists (
          select 1
          from public.class_bookings cb
          where cb.gym_id = p_gym_id
            and cb.profile_id = c.profile_id
            and cb.attended_at is not null
            and cb.attended_at >= now() - make_interval(days => v_rule.threshold_days)
        )
        when 'on_plan' then exists (
          select 1
          from public.plan_subscriptions ps
          where ps.gym_id = p_gym_id
            and ps.profile_id = c.profile_id
            and ps.plan_id = v_rule.plan_id
            and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
        )
        when 'cancelling' then exists (
          select 1
          from public.plan_subscriptions ps
          where ps.gym_id = p_gym_id
            and ps.profile_id = c.profile_id
            and ps.status = 'cancelled_at_period_end'
        )
        when 'joined_within' then
          c.joined_at >= now() - make_interval(days => v_rule.threshold_days)
        else false
      end
    on conflict (gym_id, profile_id, label) do nothing;

    get diagnostics v_loop_count = row_count;
    v_total := v_total + v_loop_count;
  end loop;

  return v_total;
end;
$$;

revoke execute on function public._apply_tag_rules(uuid, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 4. apply_tag_rules — same client surface, capability-gated, delegates
-- ============================================================================

create or replace function public.apply_tag_rules(p_gym_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.effective_can(p_gym_id, 'can_manage_tags') then
    raise exception 'Not authorised';
  end if;

  return public._apply_tag_rules(p_gym_id, v_uid);
end;
$$;

-- ============================================================================
-- 5. Nightly sweep
-- ============================================================================
--
-- Covers gyms with any rule OR any lingering auto tag: a gym whose
-- last rule was paused still needs its stale auto tags cleared, which
-- the delete-then-rebuild does even when no rule inserts anything.
-- Per-gym exception handling so one bad gym doesn't starve the rest.

create function public.recompute_auto_tags()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym    uuid;
  v_gyms   integer := 0;
  v_tags   integer := 0;
  v_errors integer := 0;
begin
  for v_gym in
    select gym_id from public.tag_rules
    union
    select gym_id from public.member_tags where source = 'auto'
  loop
    begin
      v_tags := v_tags + public._apply_tag_rules(v_gym, null);
      v_gyms := v_gyms + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object('gyms', v_gyms, 'tags', v_tags, 'errors', v_errors);
end;
$$;

revoke execute on function public.recompute_auto_tags()
  from public, anon, authenticated;

select cron.schedule('recompute-auto-tags', '45 3 * * *',
  $$select public._log_cron_run('recompute-auto-tags', public.recompute_auto_tags());$$);

commit;
