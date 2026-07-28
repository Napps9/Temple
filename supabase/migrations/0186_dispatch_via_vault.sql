-- The two cron dispatchers have never been able to reach their worker.
--
-- Both read an app.* GUC to decide where to POST:
--   dispatch_email_automations  → app.automation_worker_url   (0116:271)
--   dispatch_scheduled_campaigns → app.campaign_worker_url    (0183:177)
--
-- 0121 already established, in this project, that hosted Supabase blocks
-- ALTER DATABASE and ALTER ROLE for the postgres role (42501) and the
-- plan's dashboard exposes no custom Postgres config — so an app.* GUC
-- cannot be set here at all. current_setting(..., true) returns null, the
-- net.http_post is skipped, and the sweep reports success.
--
-- What that costs:
--
--   * Email automations (since 0116) enqueue email_automation_runs rows
--     and nothing ever drains them. Nothing else invokes the worker —
--     the cron dispatcher is the only caller. So the member-joined,
--     first-class, inactive and lead-cold automations have never sent.
--   * Scheduled campaigns (0183, shipped hours ago) snapshot recipients,
--     flip the campaign to 'sending', and mail nobody. The client only
--     invokes send-campaign on a manual send, so those recipients stay
--     queued under a campaign that reads as sending.
--
-- Both were invisible because a skipped POST looks exactly like a quiet
-- period. The scheduled-campaign one is worse than inert: it moves the
-- campaign OUT of a state anything would retry.
--
-- Fix: 0121's pattern, which this project has already proved works here —
-- hardcode the functions URL (not sensitive; the project ref is public in
-- the client bundle via EXPO_PUBLIC_SUPABASE_URL) and take the credential
-- from Vault.
--
-- The credential is the service role key rather than a new shared secret,
-- deliberately: send-campaign already accepts it (the _shared/caller.ts
-- bypass), send-email-automations gets the same check below, and it is
-- already in both functions' env. A new x-automation-secret would need a
-- Vault row AND a dashboard env var; this needs only the Vault row.
--
-- ONE-TIME SETUP after this deploys — run in the SQL editor, never
-- committed, since this is the actual secret value:
--
--   select vault.create_secret(
--     '<SUPABASE_SERVICE_ROLE_KEY>', 'worker_service_key');
--
-- Until that row exists both dispatchers are no-ops, and say so rather
-- than pretending: a due campaign stays 'scheduled' and is retried on the
-- next sweep instead of being stranded mid-send.

begin;

create or replace function public._worker_service_key()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'worker_service_key' limit 1;
$$;

revoke execute on function public._worker_service_key()
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
  v_row  record;
  v_sent integer := 0;
  v_key  text := public._worker_service_key();
begin
  -- No credential means no way to tell the worker to send. Bail before
  -- touching anything: _send_due_campaign flips the campaign to 'sending',
  -- and a campaign in that state is not picked up by this sweep again, so
  -- proceeding would strand its recipients permanently. Staying
  -- 'scheduled' is what makes this recoverable the moment the Vault row
  -- appears.
  if v_key is null then
    return 0;
  end if;

  for v_row in
    select id from public.email_campaigns
    where status = 'scheduled' and scheduled_for is not null
      and scheduled_for <= now()
    order by scheduled_for
  loop
    if public._send_due_campaign(v_row.id) > 0 then
      v_sent := v_sent + 1;
      begin
        perform net.http_post(
          url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-campaign',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
          ),
          body := jsonb_build_object('campaign_id', v_row.id)
        );
      exception when others then
        -- pg_net missing or endpoint down. The campaign stays 'sending'
        -- with its recipients queued; the next manual open or invoke picks
        -- it up. Swallowed so one bad endpoint cannot abort the sweep and
        -- take every other gym's due campaign with it.
        null;
      end;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

-- ============================================================================
-- Email automations
-- ============================================================================
--
-- Body is 0116's verbatim apart from the URL and credential. Unlike the
-- campaign sweep there is nothing to strand here — enqueue_due_automation_runs
-- leaves rows 'queued' and idempotent, so a missing key just defers them.

create or replace function public.dispatch_email_automations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
  v_key text := public._worker_service_key();
begin
  v_new := public.enqueue_due_automation_runs();

  if v_key is not null then
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-email-automations',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('enqueued', v_new)
      );
    exception when others then
      null; -- pg_net missing / endpoint down — rows stay queued, retryable.
    end;
  end if;

  return v_new;
end;
$$;

revoke execute on function public.dispatch_email_automations()
  from public, anon, authenticated;

commit;
