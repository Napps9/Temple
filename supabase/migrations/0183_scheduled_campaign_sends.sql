-- Send a campaign later.
--
-- email_campaigns has had scheduled_for and a 'scheduled' status since
-- 0044, campaignStatusMeta has had an amber "Scheduled" badge for as long,
-- and nothing has ever written the column — comms_send_campaign actively
-- nulls it on send. So a gym writing a Sunday-evening newsletter has had
-- to be at a keyboard on Sunday evening.
--
-- The machinery to copy is the automations one (0116/0117): a pg_cron job
-- calls a definer dispatcher, which enqueues and then best-effort
-- net.http_posts a worker behind a shared secret, swallowing failures so a
-- missing pg_net or a down endpoint leaves work queued and retryable.
--
-- Two things had to change to reuse it, both from the same root: under
-- cron there is no auth.uid().
--
--   1. comms_send_campaign authorises with effective_can, which reads
--      auth.uid(). A cron-driven send cannot use it. _send_due_campaign
--      below authorises on the CAMPAIGN ROW instead — it was scheduled by
--      someone who held the capability at the time, and the scheduling RPC
--      is where that is checked.
--   2. send-campaign only re-authenticates the caller's JWT, so cron
--      cannot invoke it. It grows the x-automation-secret path
--      send-email-automations already has (handled in the function).

begin;

-- ============================================================================
-- 1. Scheduling — the capability check happens HERE, while a user exists
-- ============================================================================

create or replace function public.comms_schedule_campaign(
  p_campaign_id uuid,
  p_send_at     timestamptz,
  p_html        text,
  p_text        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     uuid;
  v_status  text;
  v_subject text;
begin
  select gym_id, status, subject
    into v_gym, v_status, v_subject
    from public.email_campaigns where id = p_campaign_id
    for update;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'Campaign cannot be scheduled from status %', v_status;
  end if;
  if length(trim(coalesce(v_subject, ''))) = 0 then
    raise exception 'Add a subject line before scheduling';
  end if;
  if p_send_at is null or p_send_at <= now() then
    raise exception 'Pick a time in the future';
  end if;

  -- The document is compiled and stored NOW, not at send time. What goes
  -- out has to be what was approved when the button was pressed; a
  -- late-edited draft quietly changing a scheduled send is the kind of
  -- surprise nobody wants from a mailing tool.
  update public.email_campaigns
    set status        = 'scheduled',
        scheduled_for = p_send_at,
        compiled_html = p_html,
        compiled_text = p_text,
        updated_at    = now()
    where id = p_campaign_id;
end;
$$;

grant execute on function public.comms_schedule_campaign(uuid, timestamptz, text, text)
  to authenticated;

create or replace function public.comms_unschedule_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.email_campaigns
    where id = p_campaign_id and status = 'scheduled'
    for update;
  if v_gym is null then
    raise exception 'Campaign is not scheduled';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  update public.email_campaigns
    set status = 'draft', scheduled_for = null, updated_at = now()
    where id = p_campaign_id;
end;
$$;

grant execute on function public.comms_unschedule_campaign(uuid) to authenticated;

-- ============================================================================
-- 2. The cron side — no user, so no effective_can
-- ============================================================================

create or replace function public._send_due_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym      uuid;
  v_status   text;
  v_audience jsonb;
  v_topic    uuid;
  v_count    integer;
begin
  select gym_id, status, audience, topic_id
    into v_gym, v_status, v_audience, v_topic
    from public.email_campaigns where id = p_campaign_id
    for update;
  if v_gym is null or v_status <> 'scheduled' then
    return 0;
  end if;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, full_name, status)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued'
  from public.comms_audience_rows(v_gym, v_audience, v_topic) r
  on conflict (campaign_id, lower(email)) do nothing;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;

  -- An audience that emptied between scheduling and sending is a failed
  -- campaign, not an exception: raising here would abort the whole sweep
  -- and take every other gym's due campaign with it.
  if v_count = 0 then
    update public.email_campaigns
      set status = 'failed', updated_at = now()
      where id = p_campaign_id;
    return 0;
  end if;

  update public.email_campaigns
    set status          = 'sending',
        recipient_count = v_count,
        scheduled_for   = null,
        updated_at      = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

revoke execute on function public._send_due_campaign(uuid)
  from public, anon, authenticated;

create or replace function public.dispatch_scheduled_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    record;
  v_sent   integer := 0;
  v_url    text := current_setting('app.campaign_worker_url', true);
  v_secret text := coalesce(current_setting('app.campaign_worker_secret', true), '');
begin
  for v_row in
    select id from public.email_campaigns
    where status = 'scheduled' and scheduled_for is not null
      and scheduled_for <= now()
    order by scheduled_for
  loop
    if public._send_due_campaign(v_row.id) > 0 then
      v_sent := v_sent + 1;
      if v_url is not null and v_url <> '' then
        begin
          perform net.http_post(
            url := v_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-automation-secret', v_secret
            ),
            body := jsonb_build_object('campaign_id', v_row.id)
          );
        exception when others then
          -- pg_net missing or endpoint down. The campaign stays 'sending'
          -- with its recipients queued, and the next invoke picks it up —
          -- same contract as the automations dispatcher.
          null;
        end;
      end if;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

commit;
