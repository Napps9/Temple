-- 0111_security_monitor.sql
--
-- Automated security monitor. The breach-response runbook could only promise
-- manual detection; this adds a scheduled function that computes concrete
-- breach signals in SQL and records them, with optional active email.
--
-- HONEST SCOPE (see docs/legal/breach-response.md): it flags SPECIFIC signals,
-- not "all breaches". It does not see non-logged/service-role health reads,
-- present-but-misconfigured RLS policies, or guarantee the auth-log shape.

create table if not exists public.security_alerts (
  id          uuid primary key default gen_random_uuid(),
  category    text not null
    check (category in ('rls_disabled', 'health_exfiltration', 'auth_anomaly')),
  gym_id      uuid references public.gyms(id) on delete set null,
  actor_id    uuid references public.profiles(id) on delete set null,
  detail      text not null,
  metric      integer,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Platform-level, not gym-facing: RLS on with NO policy, so only the service
-- role and security-definer functions can touch it. Temple reviews via SQL.
alter table public.security_alerts enable row level security;

-- Actor-centric lookups for the exfiltration query (none existed before).
create index if not exists health_data_access_log_actor_idx
  on public.health_data_access_log (actor_id, created_at desc);

-- Runs the checks, records new alerts (dedup'd against still-open rows), and
-- optionally notifies. Returns the count of new alerts. Runs as owner via
-- pg_cron; no client grant (nothing reads its output but Temple).
create or replace function public.run_security_monitor()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer := 0;
  v_row record;
  v_url text := current_setting('app.security_alert_url', true);
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

  -- Optional active notify, only if configured out-of-band (GUC). A notify
  -- failure must never abort detection.
  if v_new > 0 and v_url is not null and v_url <> '' then
    begin
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-security-secret',
          coalesce(current_setting('app.security_alert_secret', true), '')
        ),
        body := jsonb_build_object('new_alerts', v_new)
      );
    exception when others then
      null; -- pg_net missing / endpoint down — alerts are still recorded.
    end;
  end if;

  return v_new;
end;
$$;
