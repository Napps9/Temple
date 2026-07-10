-- Email automations (0120): send_automation_test can target a follow-up step,
-- enqueuing a test run to the caller with that step_id; null tests the primary.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@testsend.test');
  v_gym uuid := _test_mk_gym('Test Send Gym', 'testsend-gym');
  v_a1 uuid; v_a2 uuid; v_step uuid; v_step_other uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.email_automations (gym_id, name, trigger_type, compiled_html, created_by)
    values (v_gym, 'A1', 'member_joined', '<html>hi</html>', v_owner) returning id into v_a1;
  insert into public.email_automations (gym_id, name, trigger_type, compiled_html, created_by)
    values (v_gym, 'A2', 'member_joined', '<html>hi</html>', v_owner) returning id into v_a2;
  insert into public.email_automation_steps (automation_id, gym_id, step_index, compiled_html)
    values (v_a1, v_gym, 0, '<html>step</html>') returning id into v_step;
  insert into public.email_automation_steps (automation_id, gym_id, step_index, compiled_html)
    values (v_a2, v_gym, 0, '<html>step</html>') returning id into v_step_other;

  perform set_config('test.a1', v_a1::text, true);
  perform set_config('test.step', v_step::text, true);
  perform set_config('test.step_other', v_step_other::text, true);

  perform _test_act_as(v_owner);
  perform send_automation_test(v_a1, v_step);
  perform send_automation_test(v_a1, null);
end $$;

-- 1. The step test enqueues a run carrying that step_id, to the caller.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a1')::uuid
       and step_id = current_setting('test.step')::uuid
       and recipient_email = 'owner@testsend.test'
       and status = 'queued'),
  1, 'send_automation_test with a step enqueues a test run for that step');

-- 2. The primary test enqueues a run with a null step_id.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a1')::uuid
       and step_id is null
       and recipient_email = 'owner@testsend.test'),
  1, 'send_automation_test with no step tests the primary email');

-- 3. Both are test runs (idempotency key namespaced :test:).
select is(
  (select bool_and(idempotency_key like '%:test:%')
     from public.email_automation_runs
     where automation_id = current_setting('test.a1')::uuid),
  true, 'test sends use the :test: idempotency namespace');

-- 4. A step from a different automation is rejected.
select throws_ok(
  format('select public.send_automation_test(%L, %L)',
         current_setting('test.a1'), current_setting('test.step_other')),
  'Step does not belong to this automation',
  'send_automation_test rejects a step from another automation');

select * from finish();
rollback;
