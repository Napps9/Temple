-- 0281: a crash report lands with the caller's gym, the gym's owner can
-- read it, nobody else can, a runaway caller is capped, and the sweep
-- says what it did.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('broke-owner@example.com');
  v_member uuid := _test_mk_user('broke-member@example.com');
  v_other  uuid := _test_mk_user('broke-other-owner@example.com');
  v_gym    uuid := _test_mk_gym('Broke Gym', 'broke-gym');
  v_gym2   uuid := _test_mk_gym('Other Gym', 'broke-other-gym');
begin
  perform _test_mk_membership(v_gym,  v_owner,  'owner');
  perform _test_mk_membership(v_gym,  v_member, 'member');
  perform _test_mk_membership(v_gym2, v_other,  'owner');
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.gym',    v_gym::text,    true);
end;
$$;

select ok(
  not has_table_privilege('authenticated', 'public.client_errors', 'insert'),
  'authenticated cannot write client_errors directly'
);

select _test_act_as(current_setting('test.member')::uuid);

select lives_ok(
  $$ select public.report_client_error('/book', 'Cannot read properties of undefined',
       'TypeError: at Book', null, 'web', '0.1.0') $$,
  'a member reports a crash through the RPC'
);

select is(
  (select count(*)::int from public.client_errors),
  0,
  'and cannot read it back — the table is not theirs'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.client_errors
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid
      and route = '/book'),
  1,
  'the gym''s owner sees it, stamped with the member and their gym'
);

select _test_act_as(current_setting('test.other')::uuid);

select is(
  (select count(*)::int from public.client_errors),
  0,
  'another gym''s owner sees nothing'
);

-- Twenty an hour per caller: the twenty-first is dropped, not stored.
select _test_act_as(current_setting('test.member')::uuid);
select public.report_client_error('/book', 'again ' || g, null, null, 'web', null)
  from generate_series(1, 25) as g;

select _test_act_as(current_setting('test.owner')::uuid);
select is(
  (select count(*)::int from public.client_errors
    where profile_id = current_setting('test.member')::uuid),
  20,
  'a caller is capped at twenty reports an hour'
);

-- The sweep: still the superuser, as cron runs it.
reset role;
select is(
  public.purge_old_client_errors(),
  0,
  'the sweep finds nothing older than thirty days'
);

select ok(
  exists (select 1 from public.cron_run_log
            where job_name = 'purge-old-client-errors'),
  'and still writes its cron_run_log row'
);

select * from finish();
rollback;
