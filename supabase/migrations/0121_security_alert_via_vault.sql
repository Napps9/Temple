-- 0121_security_alert_via_vault.sql
--
-- 0111/0112 read the security-alert webhook URL + secret from Postgres
-- GUCs (app.security_alert_url / app.security_alert_secret), set via
-- ALTER DATABASE/ROLE. Hosted Supabase blocks both for the `postgres`
-- role (permission denied, 42501) and the Free-plan dashboard doesn't
-- expose "Custom Postgres config" either — there was no way to actually
-- set them. Move the secret into Vault instead (built into every project)
-- and hardcode the URL, which isn't sensitive: the project ref is already
-- public via EXPO_PUBLIC_SUPABASE_URL in the client bundle.
--
-- One-time setup after this deploys, run in the SQL editor (not committed
-- to git — this is the actual secret value):
--   select vault.create_secret('<your SECURITY_ALERT_SECRET value>', 'security_alert_secret');

create or replace function public.run_security_monitor()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer := 0;
  v_row record;
  v_secret text;
begin
  -- 1. RLS regression: a public base table with row security OFF is directly
  --    reachable by anon/authenticated through PostgREST — a real exposure.
  for v_row in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity = false
  loop
    if not exists (
      select 1 from public.security_alerts
       where category = 'rls_disabled' and detail = v_row.relname
         and resolved_at is null
    ) then
      insert into public.security_alerts (category, detail)
        values ('rls_disabled', v_row.relname);
      v_new := v_new + 1;
    end if;
  end loop;

  -- 2. Health-data exfiltration: an actor who viewed an unusually high number
  --    of DISTINCT subjects' health data in the last hour (staff-surface
  --    views, logged via log_health_data_access). One open alert per actor.
  for v_row in
    select gym_id, actor_id, count(distinct subject_profile_id) as subjects
      from public.health_data_access_log
     where action = 'view'
       and created_at > now() - interval '1 hour'
       and actor_id is not null
     group by gym_id, actor_id
    having count(distinct subject_profile_id) >= 20
  loop
    if not exists (
      select 1 from public.security_alerts
       where category = 'health_exfiltration'
         and gym_id = v_row.gym_id and actor_id = v_row.actor_id
         and resolved_at is null
         and created_at > now() - interval '1 hour'
    ) then
      insert into public.security_alerts (category, gym_id, actor_id, detail, metric)
        values ('health_exfiltration', v_row.gym_id, v_row.actor_id,
                'actor viewed ' || v_row.subjects
                  || ' members'' health data in 1h', v_row.subjects);
      v_new := v_new + 1;
    end if;
  end loop;

  -- 3. Auth anomaly (best-effort). The auth.audit_log_entries payload shape is
  --    Supabase-internal, so wrap it: a schema change must never break the run.
  begin
    for v_row in
      select count(*) as n
        from auth.audit_log_entries
       where created_at > now() - interval '15 minutes'
         and (payload->>'action') in ('login_failed', 'user_recovery_requested')
      having count(*) >= 50
    loop
      insert into public.security_alerts (category, detail, metric)
        values ('auth_anomaly', 'auth event burst in 15m', v_row.n);
      v_new := v_new + 1;
    end loop;
  exception when others then
    null; -- auth log unavailable / shape changed — skip, don't fail.
  end;

  -- Optional active notify: only if a secret is stashed in Vault. A notify
  -- failure must never abort detection.
  if v_new > 0 then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'security_alert_secret'
     limit 1;

    if v_secret is not null then
      begin
        perform net.http_post(
          url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/security-alert',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-security-secret', v_secret
          ),
          body := jsonb_build_object('new_alerts', v_new)
        );
      exception when others then
        null; -- pg_net missing / endpoint down — alerts are still recorded.
      end;
    end if;
  end if;

  return v_new;
end;
$$;
