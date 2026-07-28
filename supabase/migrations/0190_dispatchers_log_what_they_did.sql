-- The two dispatchers log detail, not a count.
--
-- 0189 wraps the eleven counting sweeps at the schedule, because an integer
-- is the whole story for a purge. These two are different: the number they
-- return does not distinguish the cases anyone actually needs to tell
-- apart.
--
-- "dispatch_scheduled_campaigns returned 0" is true when there was nothing
-- due, when the Vault credential is missing, and when the credential is
-- there but every POST failed. Those need three different responses, and
-- for most of tonight the difference between the first two was the whole
-- question.
--
-- So they log their own row with the shape of the run, and their schedules
-- keep calling them directly.

begin;

create or replace function public.dispatch_scheduled_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     record;
  v_sent    integer := 0;
  v_due     integer := 0;
  v_repoked integer := 0;
  v_started timestamptz := clock_timestamp();
  v_key     text := public._worker_service_key();
begin
  if v_key is null then
    -- The distinction that matters most: not "nothing to do" but "cannot
    -- do anything". Without this line the two are the same zero.
    perform public._log_cron_run('dispatch-scheduled-campaigns',
      jsonb_build_object('skipped', 'no worker_service_key in vault'));
    return 0;
  end if;

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

  -- Campaigns that reached 'sending' and stalled. Nothing else looks at
  -- these; see 0187.
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
    v_repoked := v_repoked + 1;
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

  -- repoked > 0 on consecutive runs is the signal that the worker is
  -- refusing the credential: the sweep keeps finding the same stuck
  -- campaigns and re-posting to no effect. That is exactly the state 0186
  -- shipped in, and it was invisible.
  perform public._log_cron_run('dispatch-scheduled-campaigns',
    jsonb_build_object('due', v_due, 'dispatched', v_sent, 'repoked', v_repoked),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

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
  v_key     text := public._worker_service_key();
begin
  v_new := public.enqueue_due_automation_runs();

  select count(*)::int into v_queued
    from public.email_automation_runs where status = 'queued';

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
      v_posted := true;
    exception when others then
      null;
    end;
  end if;

  -- queued climbing run after run while posted stays true is the automation
  -- version of the same signal: the worker is being told and not draining.
  perform public._log_cron_run('dispatch-email-automations',
    jsonb_build_object('enqueued', v_new, 'queued_after', v_queued,
                       'posted', v_posted,
                       'has_key', v_key is not null),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_new;
end;
$$;

revoke execute on function public.dispatch_email_automations()
  from public, anon, authenticated;

commit;
