-- Email automations (0116): enqueue_due_automation_runs selects the right
-- subjects at the right time for each trigger, respecting delays, first-class
-- semantics, the inactivity window, and lead consent.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@auto.test');
  v_coach uuid := _test_mk_user('coach@auto.test');
  v_m1 uuid := _test_mk_user('m1@auto.test');   -- joined 3 days ago (welcome due)
  v_m2 uuid := _test_mk_user('m2@auto.test');   -- joined 10 min ago (welcome not due)
  v_m3 uuid := _test_mk_user('m3@auto.test');   -- first-class subject
  v_m4 uuid := _test_mk_user('m4@auto.test');   -- lapsed (win-back due)
  v_m5 uuid := _test_mk_user('m5@auto.test');   -- recently active (not due)
  v_gym uuid := _test_mk_gym('Auto Gym', 'auto-gym');
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_b1 uuid; v_b2 uuid;
  v_a_join uuid; v_a_first uuid; v_a_inactive uuid; v_a_cold uuid;
  v_old timestamptz := now() - interval '365 days';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  perform _test_mk_membership(v_gym, v_m2, 'member');
  perform _test_mk_membership(v_gym, v_m3, 'member');
  perform _test_mk_membership(v_gym, v_m4, 'member');
  perform _test_mk_membership(v_gym, v_m5, 'member');
  update public.gym_memberships set created_at = now() - interval '3 days'  where gym_id = v_gym and profile_id = v_m1;
  update public.gym_memberships set created_at = now() - interval '10 minutes' where gym_id = v_gym and profile_id = v_m2;

  -- member_first_class: m3 attended two classes; b1 is the earlier.
  v_s1 := _test_mk_session(v_gym, v_coach, now() - interval '3 days');
  v_s2 := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_b1 := _test_mk_booking(v_s1, v_m3);
  v_b2 := _test_mk_booking(v_s2, v_m3);
  -- attended_at requires marked_by (class_bookings_marked_by_required).
  update public.class_bookings set attended_at = now() - interval '3 days', marked_by = v_coach where id = v_b1;
  update public.class_bookings set attended_at = now() - interval '2 days', marked_by = v_coach where id = v_b2;

  -- member_inactive: m4 last attended 30 days ago; m5 attended 5 days ago.
  v_s3 := _test_mk_session(v_gym, v_coach, now() - interval '30 days');
  v_s4 := _test_mk_session(v_gym, v_coach, now() - interval '5 days');
  update public.class_bookings set attended_at = now() - interval '30 days', marked_by = v_coach where id = _test_mk_booking(v_s3, v_m4);
  update public.class_bookings set attended_at = now() - interval '5 days',  marked_by = v_coach where id = _test_mk_booking(v_s4, v_m5);

  insert into public.email_automations (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'Welcome', true, 'member_joined', 1440, '<html>hi</html>', v_owner, v_old) returning id into v_a_join;
  insert into public.email_automations (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'First class', true, 'member_first_class', 0, '<html>hi</html>', v_owner, v_old) returning id into v_a_first;
  insert into public.email_automations (gym_id, name, enabled, trigger_type, params, compiled_html, created_by, created_at)
    values (v_gym, 'Win back', true, 'member_inactive', '{"inactive_days":21}', '<html>hi</html>', v_owner, v_old) returning id into v_a_inactive;
  insert into public.email_automations (gym_id, name, enabled, trigger_type, params, compiled_html, created_by, created_at)
    values (v_gym, 'Cold lead', true, 'lead_cold', '{"cold_hours":24}', '<html>hi</html>', v_owner, v_old) returning id into v_a_cold;

  -- Leads: L1 due (cold, consented, 2 days old); L2 no consent; L3 converted.
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at)
    values (v_gym, 'Cold Consented', 'l1@auto.test', 'cold', true, now() - interval '2 days');
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at)
    values (v_gym, 'No Consent', 'l2@auto.test', 'cold', false, now() - interval '2 days');
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at, converted_profile_id, converted_at)
    values (v_gym, 'Converted', 'l3@auto.test', 'cold', true, now() - interval '2 days', v_m1, now());

  perform enqueue_due_automation_runs();

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.m2', v_m2::text, true);
  perform set_config('test.m3', v_m3::text, true);
  perform set_config('test.m4', v_m4::text, true);
  perform set_config('test.m5', v_m5::text, true);
  perform set_config('test.b1', v_b1::text, true);
  perform set_config('test.a_join', v_a_join::text, true);
  perform set_config('test.a_first', v_a_first::text, true);
  perform set_config('test.a_inactive', v_a_inactive::text, true);
  perform set_config('test.a_cold', v_a_cold::text, true);
end $$;

-- 1. Welcome fires for the member who joined 3 days ago.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_join')::uuid
       and subject_profile_id = current_setting('test.m1')::uuid),
  1, 'member_joined enqueues the member past the delay window');

-- 2. Welcome does not fire for the member who joined 10 minutes ago.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_join')::uuid
       and subject_profile_id = current_setting('test.m2')::uuid),
  0, 'member_joined skips a member still inside the delay window');

-- 3. First-class fires exactly once for m3.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_first')::uuid
       and subject_profile_id = current_setting('test.m3')::uuid),
  1, 'member_first_class enqueues once per member');

-- 4. ...keyed to the EARLIEST attended booking, not the later one.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_first')::uuid
       and idempotency_key like '%:booking:' || current_setting('test.b1')),
  1, 'member_first_class keys off the first attended booking');

-- 5. Win-back fires for the member last seen 30 days ago.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_inactive')::uuid
       and subject_profile_id = current_setting('test.m4')::uuid),
  1, 'member_inactive enqueues a member past the inactivity window');

-- 6. Win-back does not fire for the member seen 5 days ago.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_inactive')::uuid
       and subject_profile_id = current_setting('test.m5')::uuid),
  0, 'member_inactive skips a recently-active member');

-- 7. Cold-lead fires for the consented lead.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_cold')::uuid
       and recipient_email = 'l1@auto.test'),
  1, 'lead_cold enqueues a cold, consented, un-converted lead');

-- 8. Cold-lead fires for ONLY that lead (no-consent + converted excluded).
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a_cold')::uuid),
  1, 'lead_cold excludes leads without consent and already-converted leads');

select * from finish();
rollback;
