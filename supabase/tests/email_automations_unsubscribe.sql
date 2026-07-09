-- Email automations (0116): unsubscribe + consent withdrawal reuse the
-- existing suppression model. A member unsubscribe writes the right
-- email_unsubscribes row (blanket or per-topic) and removes them from future
-- enqueues; a lead withdrawal clears marketing_consent.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@unsub.test');
  v_m1 uuid := _test_mk_user('m1@unsub.test');
  v_m2 uuid := _test_mk_user('m2@unsub.test');
  v_gym uuid := _test_mk_gym('Unsub Gym', 'unsub-gym');
  v_topic uuid;
  v_a1 uuid; v_a2 uuid; v_at uuid; v_ac uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_old timestamptz := now() - interval '365 days';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  perform _test_mk_membership(v_gym, v_m2, 'member');
  update public.gym_memberships set created_at = now() - interval '3 days'
    where gym_id = v_gym and profile_id in (v_m1, v_m2);
  insert into public.gym_email_topics (gym_id, label) values (v_gym, 'Newsletter') returning id into v_topic;

  -- Blanket unsubscribe path: automation with no topic.
  insert into public.email_automations (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'A1', true, 'member_joined', 0, '<html/>', v_owner, v_old) returning id into v_a1;
  perform enqueue_due_automation_runs();
  select id into v_r1 from public.email_automation_runs where automation_id = v_a1 and subject_profile_id = v_m1;
  perform automation_unsubscribe(v_r1);

  -- Per-topic unsubscribe path: automation under a topic, member m2.
  insert into public.email_automations (gym_id, name, enabled, trigger_type, delay_minutes, topic_id, compiled_html, created_by, created_at)
    values (v_gym, 'AT', true, 'member_joined', 0, v_topic, '<html/>', v_owner, v_old) returning id into v_at;
  perform enqueue_due_automation_runs();
  select id into v_r2 from public.email_automation_runs where automation_id = v_at and subject_profile_id = v_m2;
  perform automation_unsubscribe(v_r2);

  -- A second blanket automation created AFTER m1 unsubscribed.
  insert into public.email_automations (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'A2', true, 'member_joined', 0, '<html/>', v_owner, v_old) returning id into v_a2;
  perform enqueue_due_automation_runs();

  -- Lead consent withdrawal.
  insert into public.email_automations (gym_id, name, enabled, trigger_type, params, compiled_html, created_by, created_at)
    values (v_gym, 'AC', true, 'lead_cold', '{"cold_hours":24}', '<html/>', v_owner, v_old) returning id into v_ac;
  insert into public.leads (gym_id, full_name, email, status, marketing_consent, captured_at)
    values (v_gym, 'Cold Lead', 'lead@unsub.test', 'cold', true, now() - interval '2 days');
  perform enqueue_due_automation_runs();
  select id into v_r3 from public.email_automation_runs where automation_id = v_ac;
  perform lead_withdraw_marketing_consent(v_r3);

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.m2', v_m2::text, true);
  perform set_config('test.topic', v_topic::text, true);
  perform set_config('test.a2', v_a2::text, true);
end $$;

-- 1. Member unsubscribe wrote a blanket suppression row.
select is(
  (select count(*)::int from public.email_unsubscribes
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'm1@unsub.test' and topic_id is null),
  1, 'automation_unsubscribe writes a blanket email_unsubscribes row');

-- 2. Per-topic unsubscribe wrote a topic-scoped row (not blanket).
select is(
  (select count(*)::int from public.email_unsubscribes
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'm2@unsub.test'
       and topic_id = current_setting('test.topic')::uuid),
  1, 'a topic automation unsubscribe writes a per-topic row');

-- 3. The unsubscribed member is excluded from a later automation's enqueue.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a2')::uuid
       and subject_profile_id = current_setting('test.m1')::uuid),
  0, 'an unsubscribed member is dropped from future enqueues');

-- 4. Lead consent withdrawal cleared the flag.
select is(
  (select marketing_consent from public.leads where lower(email) = 'lead@unsub.test'),
  false, 'lead_withdraw_marketing_consent clears marketing_consent');

select * from finish();
rollback;
