-- Make the cron dispatchers authenticate with a secret the operator can
-- actually set, instead of the edge function's injected service-role key.
--
-- The service-key approach (0186) is unworkable on this project: it needs
-- the value stored in Vault to byte-match the edge function's
-- SUPABASE_SERVICE_ROLE_KEY, and under Supabase's new API-key system that
-- value is not something an operator can reliably obtain — the dashboard
-- shows sb_publishable_/sb_secret_ keys, the function's env resolves the
-- legacy name to something else again, and every combination we tried
-- 403'd. A whole evening was lost to it.
--
-- Both workers already accept a second credential: an x-automation-secret
-- header matched against the AUTOMATION_WORKER_SECRET env var
-- (send-email-automations, and send-campaign via the same name). That path
-- was dead only because the env var was unset and the dispatchers never
-- sent the header. This wires it up and decouples worker auth from
-- Supabase's key era entirely.
--
-- TWO layers have to be satisfied, which is the subtlety that cost us:
--   1. Supabase's gateway (Kong) rejects any request without a VALID
--      project apikey — even for verify_jwt=false functions. A random
--      shared secret in Authorization gets a gateway 401 before the
--      function runs. So the dispatcher sends the PUBLISHABLE key (public,
--      safe to store) in the apikey header purely to get through the gate.
--   2. The function then trusts the x-automation-secret header. That is the
--      operator-chosen secret, in a header Kong ignores.
--
-- send-campaign also needs verify_jwt=false for this to work (its config
-- entry is flipped alongside this migration); it already re-authorises
-- every caller itself (effective_can for a person, the shared secret for
-- cron), so the gateway's JWT check was redundant. send-email-automations
-- is already verify_jwt=false.
--
-- ONE-TIME SETUP after deploy (values never committed):
--   1. Pick a random secret, e.g.  openssl rand -hex 32
--   2. Dashboard -> Edge Functions -> Secrets: set
--        AUTOMATION_WORKER_SECRET = <that secret>
--   3. SQL editor, once:
--        select vault.create_secret('<that secret>',        'worker_shared_secret');
--        select vault.create_secret('<publishable key>',    'worker_gateway_key');
--      The publishable key is Settings -> API Keys -> Publishable
--      (sb_publishable_...); it is public, which is why it can live in a
--      committed header. The shared secret must equal step 2's value.
--   The old worker_service_key Vault row is no longer read and can be left
--   or deleted.

begin;

create or replace function public._worker_shared_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'worker_shared_secret' limit 1;
$$;
revoke execute on function public._worker_shared_secret()
  from public, anon, authenticated;

create or replace function public._worker_gateway_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'worker_gateway_key' limit 1;
$$;
revoke execute on function public._worker_gateway_key()
  from public, anon, authenticated;

-- ============================================================================
-- Scheduled campaigns
-- ============================================================================

create or replace function public.dispatch_scheduled_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      record;
  v_sent     integer := 0;
  v_due      integer := 0;
  v_repoked  integer := 0;
  v_finished integer := 0;
  v_started  timestamptz := clock_timestamp();
  v_secret   text := public._worker_shared_secret();
  v_gateway  text := public._worker_gateway_key();
  v_headers  jsonb;
begin
  if v_secret is null or v_gateway is null then
    perform public._log_cron_run('dispatch-scheduled-campaigns',
      jsonb_build_object('skipped',
        'missing worker_shared_secret or worker_gateway_key in vault'));
    return 0;
  end if;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', v_gateway,
    'x-automation-secret', v_secret);

  for v_row in
    select id from public.email_campaigns
    where status = 'scheduled' and scheduled_for is not null
      and scheduled_for <= now()
    order by scheduled_for
  loop
    v_due := v_due + 1;
    if public._send_due_campaign(v_row.id) > 0 then
      v_sent := v_sent + 1;
      begin
        perform net.http_post(
          url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-campaign',
          headers := v_headers,
          body := jsonb_build_object('campaign_id', v_row.id));
      exception when others then
        null;
      end;
    end if;
  end loop;

  -- Stuck in 'sending' with recipients still queued: re-poke (0187).
  for v_row in
    select c.id from public.email_campaigns c
    where c.status = 'sending'
      and c.updated_at < now() - interval '10 minutes'
      and exists (
        select 1 from public.email_campaign_recipients r
        where r.campaign_id = c.id and r.status = 'queued')
    order by c.updated_at
    limit 20
  loop
    v_repoked := v_repoked + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-campaign',
        headers := v_headers,
        body := jsonb_build_object('campaign_id', v_row.id));
    exception when others then
      null;
    end;
  end loop;

  -- Stuck in 'sending' with nothing queued: finish it (0191).
  update public.email_campaigns c
    set status = case
          when exists (
            select 1 from public.email_campaign_recipients r
            where r.campaign_id = c.id
              and r.status in ('sent', 'delivered', 'simulated')
          ) then 'sent' else 'failed' end,
        sent_at = coalesce(c.sent_at, now()),
        updated_at = now()
    where c.status = 'sending'
      and c.updated_at < now() - interval '10 minutes'
      and not exists (
        select 1 from public.email_campaign_recipients r
        where r.campaign_id = c.id and r.status = 'queued');
  get diagnostics v_finished = row_count;

  perform public._log_cron_run('dispatch-scheduled-campaigns',
    jsonb_build_object('due', v_due, 'dispatched', v_sent,
                       'repoked', v_repoked, 'finished', v_finished),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

-- ============================================================================
-- Email automations
-- ============================================================================

create or replace function public.dispatch_email_automations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new     integer;
  v_queued  integer;
  v_posted  boolean := false;
  v_started timestamptz := clock_timestamp();
  v_secret  text := public._worker_shared_secret();
  v_gateway text := public._worker_gateway_key();
begin
  v_new := public.enqueue_due_automation_runs();

  select count(*)::int into v_queued
    from public.email_automation_runs where status = 'queued';

  if v_secret is not null and v_gateway is not null then
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-email-automations',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_gateway,
          'x-automation-secret', v_secret),
        body := jsonb_build_object('enqueued', v_new));
      v_posted := true;
    exception when others then
      null;
    end;
  end if;

  perform public._log_cron_run('dispatch-email-automations',
    jsonb_build_object('enqueued', v_new, 'queued_after', v_queued,
                       'posted', v_posted,
                       'has_secret', v_secret is not null and v_gateway is not null),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_new;
end;
$$;

revoke execute on function public.dispatch_email_automations()
  from public, anon, authenticated;

commit;
