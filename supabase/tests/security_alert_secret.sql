-- security_alert_secret (0126) — the security-alert edge function verifies
-- its shared secret against Vault through this RPC, so the value is
-- single-source and can't drift out of sync with an env-var copy (the drift
-- that silently disabled breach-alert emails before).

begin;
select plan(4);

\ir _helpers.psql

-- 1. The verifier exists.
select has_function(
  'public', 'security_alert_secret_matches', array['text'],
  'security_alert_secret_matches(text) exists'
);

-- 2/3. Locked to service-role callers — never anon/authenticated.
select ok(
  not has_function_privilege(
    'authenticated', 'public.security_alert_secret_matches(text)', 'execute'),
  'authenticated cannot execute the verifier'
);
select ok(
  not has_function_privilege(
    'anon', 'public.security_alert_secret_matches(text)', 'execute'),
  'anon cannot execute the verifier'
);

-- 4. With no matching Vault secret (or Vault absent in this env) it rejects
--    any value and never raises.
select is(
  public.security_alert_secret_matches('anything'),
  false,
  'rejects an arbitrary value when no matching secret is present'
);

select * from finish();
rollback;
