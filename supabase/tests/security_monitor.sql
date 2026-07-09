-- run_security_monitor() flags a health-data exfiltration pattern once
-- (dedup on re-run) and flags a public table with RLS disabled.

begin;
select plan(4);

\ir _helpers.psql

-- Seed an exfiltration pattern: one actor viewed 25 distinct subjects' health
-- data in the last hour (direct inserts as the test superuser).
do $$
declare
  v_gym   uuid := _test_mk_gym('Sec Gym', 'secmon');
  v_actor uuid := _test_mk_user('actor@sec.test');
  v_subj  uuid;
  i int;
begin
  perform _test_mk_membership(v_gym, v_actor, 'coach');
  for i in 1..25 loop
    v_subj := _test_mk_user('subj' || i || '@sec.test');
    perform _test_mk_membership(v_gym, v_subj, 'member');
    insert into public.health_data_access_log
      (gym_id, actor_id, subject_profile_id, action)
      values (v_gym, v_actor, v_subj, 'view');
  end loop;
  perform set_config('test.actor', v_actor::text, true);
end $$;

-- 1. First run records at least the exfiltration alert.
select ok(
  public.run_security_monitor() >= 1,
  'run_security_monitor records new alerts'
);

-- 2. The heavy-access actor is flagged exactly once.
select is(
  (select count(*)::int from public.security_alerts
     where category = 'health_exfiltration'
       and actor_id = current_setting('test.actor')::uuid),
  1,
  'the exfiltration actor is flagged once'
);

-- 3. A second run within the window does not duplicate the open alert.
do $$ begin perform public.run_security_monitor(); end $$;
select is(
  (select count(*)::int from public.security_alerts
     where category = 'health_exfiltration'
       and actor_id = current_setting('test.actor')::uuid),
  1,
  'dedup: a second run does not re-flag the same actor'
);

-- 4. RLS-off detection: a deliberately-unprotected public table is named.
create table public._sec_test_unprotected (id int);
do $$ begin perform public.run_security_monitor(); end $$;
select is(
  (select count(*)::int from public.security_alerts
     where category = 'rls_disabled' and detail = '_sec_test_unprotected'),
  1,
  'a public table with RLS disabled is flagged by name'
);

select * from finish();
rollback;
