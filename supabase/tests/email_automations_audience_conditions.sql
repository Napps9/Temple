-- Email automations (0118): audience conditions narrow each trigger to a
-- segment. Plan filter on member triggers, class-type filter on first-class
-- (anchored to the first class OF THAT TYPE), source filter on lead_cold.
-- Empty/absent conditions keep the fire-for-everyone default.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cond.test');
  v_coach uuid := _test_mk_user('coach@cond.test');
  v_p1 uuid := _test_mk_user('p1@cond.test');   -- on the targeted plan
  v_p2 uuid := _test_mk_user('p2@cond.test');   -- no subscription
  v_c1 uuid := _test_mk_user('c1@cond.test');   -- first class is Barbell
  v_c2 uuid := _test_mk_user('c2@cond.test');   -- first class is Yoga only
  v_gym uuid := _test_mk_gym('Cond Gym', 'cond-gym');
  v_mem1 uuid;
  v_plan uuid;
  v_ct_barbell uuid;
  v_ct_yoga uuid;
  v_src_web uuid;
  v_src_walkin uuid;
  v_s_barbell uuid; v_s_yoga uuid;
  v_b_c1 uuid; v_b_c2 uuid;
  v_a_join uuid; v_a_first uuid; v_a_cold uuid;
  v_old timestamptz := now() - interval '365 days';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mem1 := _test_mk_membership(v_gym, v_p1, 'member');
  perform _test_mk_membership(v_gym, v_p2, 'member');
  perform _test_mk_membership(v_gym, v_c1, 'member');
  perform _test_mk_membership(v_gym, v_c2, 'member');
  -- All joined 3 days ago so member_joined delay (1 day) has elapsed.
  update public.gym_memberships set created_at = now() - interval '3 days'
    where gym_id = v_gym and role = 'member';

  -- A plan + an active subscription for p1 only.
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_mem1, v_p1, v_gym, v_plan, 'active');

  -- Two class types; c1's first class is Barbell, c2's first (and only) is Yoga.
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Barbell', '#111111') returning id into v_ct_barbell;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Yoga', '#222222') returning id into v_ct_yoga;
  v_s_barbell := _test_mk_session(v_gym, v_coach, now() - interval '3 days', 60, v_ct_barbell);
  v_s_yoga    := _test_mk_session(v_gym, v_coach, now() - interval '3 days', 60, v_ct_yoga);
  v_b_c1 := _test_mk_booking(v_s_barbell, v_c1);
  v_b_c2 := _test_mk_booking(v_s_yoga, v_c2);
  update public.class_bookings set attended_at = now() - interval '3 days', marked_by = v_coach
    where id in (v_b_c1, v_b_c2);

  -- Two lead sources; one lead from each.
  insert into public.lead_sources (gym_id, label) values (v_gym, 'Website')
    returning id into v_src_web;
  insert into public.lead_sources (gym_id, label) values (v_gym, 'Walk-in')
    returning id into v_src_walkin;
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at, source_id)
    values (v_gym, 'Web Lead', 'web@cond.test', 'cold', true, now() - interval '2 days', v_src_web);
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at, source_id)
    values (v_gym, 'Walkin Lead', 'walkin@cond.test', 'cold', true, now() - interval '2 days', v_src_walkin);

  -- Automations, each scoped by conditions.
  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, conditions, compiled_html, created_by, created_at)
    values (v_gym, 'Plan welcome', true, 'member_joined', 1440,
            jsonb_build_object('plan_ids', jsonb_build_array(v_plan)),
            '<html>hi</html>', v_owner, v_old)
    returning id into v_a_join;
  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, conditions, compiled_html, created_by, created_at)
    values (v_gym, 'Barbell first class', true, 'member_first_class', 0,
            jsonb_build_object('class_type_ids', jsonb_build_array(v_ct_barbell)),
            '<html>hi</html>', v_owner, v_old)
    returning id into v_a_first;
  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, params, conditions, compiled_html, created_by, created_at)
    values (v_gym, 'Website cold', true, 'lead_cold', '{"cold_hours":24}',
            jsonb_build_object('lead_source_ids', jsonb_build_array(v_src_web)),
            '<html>hi</html>', v_owner, v_old)
    returning id into v_a_cold;

  perform enqueue_due_automation_runs();

  perform set_config('test.a_join', v_a_join::text, true);
  perform set_config('test.a_first', v_a_first::text, true);
  perform set_config('test.a_cold', v_a_cold::text, true);
  perform set_config('test.p1', v_p1::text, true);
  perform set_config('test.p2', v_p2::text, true);
  perform set_config('test.c1', v_c1::text, true);
  perform set_config('test.c2', v_c2::text, true);
end $$;

-- 1. Plan filter: the member on the plan is enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_join')::uuid
       and subject_profile_id = current_setting('test.p1')::uuid),
  1, 'member_joined with a plan filter enqueues a member on that plan');

-- 2. Plan filter: a member with no subscription is excluded.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_join')::uuid
       and subject_profile_id = current_setting('test.p2')::uuid),
  0, 'member_joined with a plan filter skips a member not on the plan');

-- 3. Plan filter: only the one matching member is enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_join')::uuid),
  1, 'member_joined plan filter enqueues exactly the matching member');

-- 4. Class-type filter: the member whose first class was Barbell is enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_first')::uuid
       and subject_profile_id = current_setting('test.c1')::uuid),
  1, 'member_first_class with a type filter enqueues the matching first class');

-- 5. Class-type filter: the member who only did Yoga is excluded.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_first')::uuid
       and subject_profile_id = current_setting('test.c2')::uuid),
  0, 'member_first_class type filter skips a member with no class of that type');

-- 6. Source filter: the website lead is enqueued and the walk-in (equally
--    cold, consented, and due, differing only in source) is excluded.
select is(
  (select string_agg(recipient_email, ',')
     from public.email_automation_runs
     where automation_id = current_setting('test.a_cold')::uuid),
  'web@cond.test', 'lead_cold source filter enqueues only the matching source');

select * from finish();
rollback;
