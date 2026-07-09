-- Email automations (0116): the sweep is idempotent (a subject is enqueued
-- exactly once), and an unsubscribed member is never enqueued (the resolver's
-- suppression is honoured).

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@idem.test');
  v_m1 uuid := _test_mk_user('m1@idem.test');
  v_m2 uuid := _test_mk_user('m2@idem.test');   -- unsubscribed
  v_gym uuid := _test_mk_gym('Idem Gym', 'idem-gym');
  v_auto uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  perform _test_mk_membership(v_gym, v_m2, 'member');
  update public.gym_memberships set created_at = now() - interval '3 days'
    where gym_id = v_gym and profile_id in (v_m1, v_m2);

  -- m2 has unsubscribed from everything (blanket).
  insert into public.email_unsubscribes (gym_id, email, profile_id, reason)
    values (v_gym, 'm2@idem.test', v_m2, 'test');

  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, compiled_html, created_by, created_at)
    values (v_gym, 'Welcome', true, 'member_joined', 0, '<html>hi</html>', v_owner, now() - interval '365 days')
    returning id into v_auto;

  perform enqueue_due_automation_runs();

  perform set_config('test.auto', v_auto::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.m2', v_m2::text, true);
end $$;

-- 1. The subscribed member is enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.auto')::uuid
       and subject_profile_id = current_setting('test.m1')::uuid),
  1, 'a subscribed member is enqueued');

-- 2. The unsubscribed member is never enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.auto')::uuid
       and subject_profile_id = current_setting('test.m2')::uuid),
  0, 'an unsubscribed member is suppressed at enqueue time');

-- 3. Re-running the sweep does not duplicate the run.
do $$ begin perform enqueue_due_automation_runs(); perform enqueue_due_automation_runs(); end $$;
select is(
  (select count(*)::int from public.email_automation_runs
     where automation_id = current_setting('test.auto')::uuid),
  1, 'the sweep is idempotent — a subject is enqueued exactly once');

select * from finish();
rollback;
