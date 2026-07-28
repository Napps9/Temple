-- A scheduled campaign that fails to reach the worker must be retryable.
--
-- 0186 claimed in its own header that send-campaign already accepted the
-- service role key "via the _shared/caller.ts bypass". It does not — that
-- bypass is on send-payment-notifications. send-campaign's only non-JWT
-- path was an x-automation-secret that 0186 does not send and that appears
-- in no runbook. So the first sweep after someone created the Vault row
-- would have posted, taken a 403, and moved on reporting success.
--
-- The function is fixed. But the reason a wrong credential was
-- catastrophic rather than merely wrong is a design fault worth removing
-- on its own: _send_due_campaign flips the campaign to 'sending' BEFORE
-- anything knows the worker was reached, net.http_post is fire-and-forget
-- so a 403 raises nothing, and a 'sending' campaign is picked up by
-- nothing afterwards — not the sweep (it filters status = 'scheduled'),
-- not comms_send_campaign (it rejects any status outside draft/scheduled),
-- not the UI. Recipients sit 'queued' under a campaign reading 'sending',
-- forever.
--
-- That is one bad deploy, one expired key or one cold start away at any
-- time, and it is exactly the failure mode this pair of migrations exists
-- to remove. So: sweep for campaigns stuck mid-send and poke them again.
-- The worker is already idempotent per recipient — it only selects
-- status = 'queued' rows, and Resend deduplicates on
-- `Idempotency-Key: <campaign>:<recipient>` — so re-poking is safe and a
-- campaign that did go out simply has nothing left to drain.

begin;

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
  if v_key is null then
    return 0;
  end if;

  -- 1. Campaigns whose time has come.
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
        null;
      end;
    end if;
  end loop;

  -- 2. Campaigns that got as far as 'sending' and stopped. Ten minutes is
  --    comfortably longer than a drain of any realistic gym's list and
  --    short enough that a stuck send is fixed within the hour. Nothing
  --    else would ever look at these again.
  for v_row in
    select c.id from public.email_campaigns c
    where c.status = 'sending'
      and c.updated_at < now() - interval '10 minutes'
      and exists (
        select 1 from public.email_campaign_recipients r
        where r.campaign_id = c.id and r.status = 'queued'
      )
    order by c.updated_at
    limit 20
  loop
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
      null;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

commit;
