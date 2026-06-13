-- comms_send_campaign now reads the campaign's topic_id and passes
-- it to the audience resolver. Without this the per-topic
-- suppression added in 0058 / 0059 only ever fires for the
-- preview-count RPC (comms_audience_count) — the actual send still
-- went out to per-topic-unsubscribed members.
--
-- Same body as the 0044 version, plus the v_topic select and the
-- three-arg comms_audience_rows call.

begin;

create or replace function public.comms_send_campaign(
  p_campaign_id uuid,
  p_html        text,
  p_text        text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym      uuid;
  v_status   text;
  v_subject  text;
  v_audience jsonb;
  v_topic    uuid;
  v_count    integer;
begin
  select gym_id, status, subject, audience, topic_id
    into v_gym, v_status, v_subject, v_audience, v_topic
    from public.email_campaigns where id = p_campaign_id;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'Campaign cannot be sent from status %', v_status;
  end if;
  if length(trim(coalesce(v_subject, ''))) = 0 then
    raise exception 'Add a subject line before sending';
  end if;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, full_name, status)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued'
  from public.comms_audience_rows(v_gym, v_audience, v_topic) r
  on conflict (campaign_id, lower(email)) do nothing;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;
  if v_count = 0 then
    raise exception 'This audience has no members with a usable email address';
  end if;

  update public.email_campaigns
    set status        = 'sending',
        recipient_count = v_count,
        compiled_html = p_html,
        compiled_text = p_text,
        scheduled_for = null,
        updated_at    = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

commit;
