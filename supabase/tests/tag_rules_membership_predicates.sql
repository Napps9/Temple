-- The 0200 predicate kinds: auto-tag rules driven by class-type
-- bookings, attendance, plan subscriptions and join date — plus the
-- config CHECK that ties class_type_id / plan_id / threshold_days to
-- the kind, the nightly sweep's client lockout, and the re-pointed
-- capability gate (a coach granted can_manage_tags can tag; staff
-- without it cannot).
--
-- Fixture shape:
--   A — attended an Intro session 5 days ago; active sub on plan P;
--       joined now.
--   B — booked a future Intro session; attended Yoga 40 days ago;
--       sub on plan Q giving notice (cancelled_at_period_end); joined now.
--   C — never booked anything; joined 100 days ago; no subs.

begin;
select plan(20);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@predicates.test');
  v_coach    uuid := _test_mk_user('coach@predicates.test');
  v_staff    uuid := _test_mk_user('staff@predicates.test');
  v_a        uuid := _test_mk_user('a@predicates.test');
  v_b        uuid := _test_mk_user('b@predicates.test');
  v_c        uuid := _test_mk_user('c@predicates.test');
  v_gym      uuid := _test_mk_gym('Predicate Gym', 'predicate-gym');
  v_mid_a    uuid;
  v_mid_b    uuid;
  v_ct_intro uuid;
  v_ct_yoga  uuid;
  v_s_past   uuid;
  v_s_future uuid;
  v_s_yoga   uuid;
  v_plan_p   uuid;
  v_plan_q   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_staff, 'staff');
  v_mid_a := _test_mk_membership(v_gym, v_a, 'member');
  v_mid_b := _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');

  update public.gym_memberships
    set created_at = now() - interval '100 days'
    where gym_id = v_gym and profile_id = v_c;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Intro', '#10B981') returning id into v_ct_intro;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Yoga', '#8B5CF6') returning id into v_ct_yoga;

  v_s_past   := _test_mk_session(v_gym, v_coach, now() - interval '5 days',  60, v_ct_intro);
  v_s_future := _test_mk_session(v_gym, v_coach, now() + interval '3 days',  60, v_ct_intro);
  v_s_yoga   := _test_mk_session(v_gym, v_coach, now() - interval '40 days', 60, v_ct_yoga);

  perform _test_mk_booking(v_s_past, v_a);
  perform _test_mk_booking(v_s_future, v_b);
  perform _test_mk_booking(v_s_yoga, v_b);
  update public.class_bookings
    set attended_at = now() - interval '5 days', marked_by = v_coach
    where class_session_id = v_s_past and profile_id = v_a;
  update public.class_bookings
    set attended_at = now() - interval '40 days', marked_by = v_coach
    where class_session_id = v_s_yoga and profile_id = v_b;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Base', 'unlimited', 5000) returning plan_id into v_plan_p;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Premium', 'unlimited', 9000) returning plan_id into v_plan_q;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_mid_a, v_a, v_gym, v_plan_p, 'active');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, cancelled_at)
    values (v_mid_b, v_b, v_gym, v_plan_q, 'cancelled_at_period_end', now());

  insert into public.tag_rules
    (gym_id, label, color, predicate_kind, threshold_days, class_type_id, plan_id, created_by)
  values
    (v_gym, 'Booked intro',    '#10B981', 'booked_class_type',    null, v_ct_intro, null,     v_owner),
    (v_gym, 'Booked intro 2d', '#10B981', 'booked_class_type',    2,    v_ct_intro, null,     v_owner),
    (v_gym, 'Did intro',       '#10B981', 'attended_class_type',  null, v_ct_intro, null,     v_owner),
    (v_gym, 'Yoga lately',     '#8B5CF6', 'attended_class_type',  30,   v_ct_yoga,  null,     v_owner),
    (v_gym, 'Ghosting',        '#EF4444', 'no_recent_attendance', 30,   null,       null,     v_owner),
    (v_gym, 'On base plan',    '#2563EB', 'on_plan',              null, null,       v_plan_p, v_owner),
    (v_gym, 'Giving notice',   '#F59E0B', 'cancelling',           null, null,       null,     v_owner),
    (v_gym, 'New member',      '#10B981', 'joined_within',        7,    null,       null,     v_owner);

  -- Coaches get can_manage_tags via override; staff keep the default (off).
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (v_gym, 'coach', 'can_manage_tags', true);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.staff', v_staff::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.c',     v_c::text,     true);
end;
$$;

-- 1. Materialise via the nightly sweep entry point so the cron path
--    (no auth context, created_by falls back to the rule author) is
--    what the predicate assertions actually exercise.
select ok(
  (public.recompute_auto_tags()->>'gyms')::integer >= 1,
  'recompute_auto_tags covers the fixture gym'
);

-- 2. booked_class_type, no window: past and future intro bookings both count.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Booked intro'),
  2::bigint,
  'Booked intro (no window) tags A (past session) and B (future session)'
);

-- 3. booked_class_type with a 2-day look-back: the 5-day-old session
--    drops out, the future booking stays.
select is(
  (select profile_id from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Booked intro 2d'),
  current_setting('test.b')::uuid,
  'Booked intro 2d keeps only B''s upcoming booking'
);

-- 4. attended_class_type: booking alone is not attendance.
select is(
  (select profile_id from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Did intro'),
  current_setting('test.a')::uuid,
  'Did intro tags only A, who checked in'
);

-- 5. attended_class_type window: B's Yoga check-in is 40 days old.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Yoga lately'),
  0::bigint,
  'Yoga lately (30d) tags nobody'
);

-- 6-7. no_recent_attendance: B (stale) and C (never), not A.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Ghosting'),
  2::bigint,
  'Ghosting tags two members'
);
select ok(
  not exists (
    select 1 from public.member_tags
    where gym_id = current_setting('test.gym')::uuid and label = 'Ghosting'
      and profile_id = current_setting('test.a')::uuid),
  'Ghosting does not tag A, who attended 5 days ago'
);

-- 8. on_plan matches the specific plan, not any live sub.
select is(
  (select profile_id from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'On base plan'),
  current_setting('test.a')::uuid,
  'On base plan tags only A; B''s sub is on another plan'
);

-- 9. cancelling.
select is(
  (select profile_id from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'Giving notice'),
  current_setting('test.b')::uuid,
  'Giving notice tags only B'
);

-- 10-11. joined_within.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and label = 'New member'),
  2::bigint,
  'New member (7d) tags the two recent joiners'
);
select ok(
  not exists (
    select 1 from public.member_tags
    where gym_id = current_setting('test.gym')::uuid and label = 'New member'
      and profile_id = current_setting('test.c')::uuid),
  'New member does not tag C, who joined 100 days ago'
);

-- 12-14. Config CHECK: kind and config columns cannot disagree.
select throws_ok(
  format($i$
    insert into public.tag_rules (gym_id, label, color, predicate_kind, created_by)
    values (%L, 'Bad booked', '#10B981', 'booked_class_type', %L)
  $i$, current_setting('test.gym'), current_setting('test.owner')),
  '23514', null,
  'booked_class_type without class_type_id violates the config CHECK'
);
select throws_ok(
  format($i$
    insert into public.tag_rules (gym_id, label, color, predicate_kind, created_by)
    values (%L, 'Bad plan', '#10B981', 'on_plan', %L)
  $i$, current_setting('test.gym'), current_setting('test.owner')),
  '23514', null,
  'on_plan without plan_id violates the config CHECK'
);
select throws_ok(
  format($i$
    insert into public.tag_rules (gym_id, label, color, predicate_kind, created_by)
    values (%L, 'Bad window', '#10B981', 'joined_within', %L)
  $i$, current_setting('test.gym'), current_setting('test.owner')),
  '23514', null,
  'joined_within without threshold_days violates the config CHECK'
);

-- 15. The sweep and the shared materialiser are not client-callable.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('recompute_auto_tags', '_apply_tag_rules')
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'))),
  '',
  'neither recompute_auto_tags nor _apply_tag_rules is callable by anon or authenticated'
);

-- 16. Cron-applied tags carry the rule author as created_by (no auth
--     context to attribute them to).
select is(
  (select distinct created_by from public.member_tags
   where gym_id = current_setting('test.gym')::uuid and source = 'auto'),
  current_setting('test.owner')::uuid,
  'sweep-applied tags fall back to the rule author for created_by'
);

-- 17-18. A coach granted can_manage_tags via override can tag manually
--        and recompute.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select lives_ok(
  format($i$
    insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    values (%L, %L, 'VIP', '#F59E0B', 'manual', %L)
  $i$, current_setting('test.gym'), current_setting('test.a'), current_setting('test.coach')),
  'coach with the can_manage_tags override can add a manual tag'
);
select ok(
  public.apply_tag_rules(current_setting('test.gym')::uuid) > 0,
  'coach with the override can recompute auto tags'
);

-- 19-20. Staff without the capability can do neither.
do $$
begin
  perform _test_act_as(current_setting('test.staff')::uuid);
end;
$$;

select throws_ok(
  format($i$
    insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    values (%L, %L, 'Nope', '#EF4444', 'manual', %L)
  $i$, current_setting('test.gym'), current_setting('test.a'), current_setting('test.staff')),
  '42501', null,
  'staff without can_manage_tags cannot add a manual tag'
);
select throws_ok(
  format($i$select public.apply_tag_rules(%L::uuid)$i$, current_setting('test.gym')),
  'P0001', 'Not authorised',
  'staff without can_manage_tags cannot recompute'
);

select * from finish();
rollback;
