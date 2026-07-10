-- Email automations (0119): multi-step sequences + send-time.
--   * the primary email and each follow-up step enqueue independently off the
--     trigger anchor, keyed so the primary's idempotency key is unchanged;
--   * _automation_send_slot rolls a due moment to the next allowed hour/day.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@seq.test');
  v_m1 uuid := _test_mk_user('m1@seq.test');   -- joined 4 days ago
  v_gym uuid := _test_mk_gym('Seq Gym', 'seq-gym');
  v_a uuid;
  v_step_due uuid;
  v_step_future uuid;
  v_old timestamptz := now() - interval '365 days';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  update public.gym_memberships set created_at = now() - interval '4 days'
    where gym_id = v_gym and profile_id = v_m1;

  -- Primary sends immediately on join; two follow-ups, one due (3 days) and
  -- one not yet (30 days).
  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'Welcome sequence', true, 'member_joined', 0, '<html>hi</html>', v_owner, v_old)
    returning id into v_a;
  insert into public.email_automation_steps
    (automation_id, gym_id, step_index, delay_minutes, subject, compiled_html)
    values (v_a, v_gym, 0, 3 * 1440, 'Day 3', '<html>step</html>')
    returning id into v_step_due;
  insert into public.email_automation_steps
    (automation_id, gym_id, step_index, delay_minutes, subject, compiled_html)
    values (v_a, v_gym, 1, 30 * 1440, 'Day 30', '<html>step</html>')
    returning id into v_step_future;

  perform enqueue_due_automation_runs();

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.step_due', v_step_due::text, true);
  perform set_config('test.step_future', v_step_future::text, true);
end $$;

-- 1. The primary email enqueues (step_id null).
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a')::uuid
       and subject_profile_id = current_setting('test.m1')::uuid
       and step_id is null),
  1, 'the primary email enqueues with a null step_id');

-- 2. The due follow-up step enqueues (its step_id).
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.a')::uuid
       and step_id = current_setting('test.step_due')::uuid),
  1, 'a follow-up step past its offset enqueues');

-- 3. The step run's idempotency key carries the :step: segment.
select is(
  (select bool_and(idempotency_key like '%:step:' || current_setting('test.step_due') || ':%')
     from public.email_automation_runs
     where step_id = current_setting('test.step_due')::uuid),
  true, 'a follow-up run keys off its step id');

-- 4. The primary key is unchanged — no :step: segment (no re-send regression).
select is(
  (select bool_and(idempotency_key not like '%:step:%')
     from public.email_automation_runs
     where automation_id = current_setting('test.a')::uuid and step_id is null),
  true, 'the primary email keeps its 0116/0118 idempotency key');

-- 5. A follow-up whose offset has not elapsed does not enqueue.
select is(
  (select count(*)::int from public.email_automation_runs
     where step_id = current_setting('test.step_future')::uuid),
  0, 'a follow-up before its offset stays unqueued');

-- 6. Send-slot: 8am base with a 9am target lands at 9am the same day (UTC).
select is(
  public._automation_send_slot('2026-07-06 08:00:00+00'::timestamptz, 9, null, 'UTC'),
  '2026-07-06 09:00:00+00'::timestamptz,
  '_automation_send_slot advances to the same-day target hour');

-- 7. Send-slot: a Monday-10am base targeting 9am on Sat/Sun rolls to Saturday.
select is(
  public._automation_send_slot('2026-07-06 10:00:00+00'::timestamptz, 9, array[6, 7], 'UTC'),
  '2026-07-11 09:00:00+00'::timestamptz,
  '_automation_send_slot rolls forward to the next allowed weekday');

select * from finish();
rollback;
