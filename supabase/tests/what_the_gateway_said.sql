-- 0282: the gateway's replies are readable by the service role and by
-- nobody a gym can sign in as.

begin;
select plan(4);

\ir _helpers.psql

select ok(
  not has_function_privilege('authenticated',
    'public.recent_worker_responses(integer)', 'execute'),
  'authenticated cannot read the worker responses'
);

select ok(
  not has_function_privilege('anon',
    'public.recent_worker_responses(integer)', 'execute'),
  'nor can anon'
);

select ok(
  has_function_privilege('service_role',
    'public.recent_worker_responses(integer)', 'execute'),
  'the service role can'
);

select lives_ok(
  $$ select * from public.recent_worker_responses(3) $$,
  'and it reads without error'
);

select * from finish();
rollback;
