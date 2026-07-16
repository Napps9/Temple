-- 0126_security_alert_secret_from_vault.sql
--
-- Make the security-alert shared secret single-source.
--
-- Before this, the secret had to be set in TWO places that had to match by
-- hand: the Vault secret `security_alert_secret` (read by run_security_monitor
-- to sign the notify) and the security-alert edge function's
-- SECURITY_ALERT_SECRET env var (compared against the header). They drifted
-- once — the Vault value was left as placeholder text — which silently
-- disabled breach-alert emails with no error anywhere.
--
-- This verifier lets the edge function check the header against Vault
-- directly, so the value lives in ONE place. The secret never leaves
-- Postgres — the function returns only a boolean. Defensive like 0121: a
-- missing/locked Vault must return false, never raise.

create or replace function public.security_alert_secret_matches(p_provided text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if p_provided is null or p_provided = '' then
    return false;
  end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'security_alert_secret'
     limit 1;
  exception when others then
    return false; -- vault unavailable / not readable
  end;
  return v_secret is not null and v_secret = p_provided;
end;
$$;

-- Only the edge function (service role) verifies secrets; never anon/authenticated.
revoke execute on function public.security_alert_secret_matches(text)
  from public, anon, authenticated;
grant execute on function public.security_alert_secret_matches(text) to service_role;
