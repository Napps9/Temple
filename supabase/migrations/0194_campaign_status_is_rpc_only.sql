-- The editor can write any column of email_campaigns, including status.
--
-- email_campaigns_update restricts WHICH ROWS a comms manager may touch
-- (status in draft, scheduled) and says nothing about which COLUMNS, so
-- the same `.update()` the editor autosaves with can set status,
-- scheduled_for, compiled_html, recipient_count or sent_at. Three of the
-- reachable outcomes:
--
--   status = 'scheduled' written directly, skipping
--   comms_schedule_campaign — no subject validation, no future-time
--   check, and since 0193 no scheduled_snapshot either, so the send
--   resolves a null audience and marks the campaign failed
--
--   status = 'sent' on a draft — a campaign that reports as delivered to
--   an audience it was never sent to
--
--   status = 'sending' on a draft — permanently stuck, since the due
--   loop filters 'scheduled' and comms_send_campaign refuses anything
--   outside draft/scheduled
--
-- None of this is what the editor does. It writes nine columns and has
-- since 0044; every status transition already goes through an RPC. The
-- grant is just wider than the code, which is the shape of most of what
-- tonight turned up.
--
-- Column-level UPDATE says that in the one place it cannot drift from.
-- RLS still applies on top: both the policy and the column grant have to
-- pass. Workers are unaffected — they hold the service key, and the
-- definer RPCs run as the owner.

begin;

-- anon too: RLS already refuses it (every policy here goes through
-- effective_can, which needs an auth.uid()), but the bootstrap hands anon
-- the same table-wide UPDATE, and a grant that is only survivable because
-- of a policy elsewhere is the arrangement this migration exists to stop.
revoke update on public.email_campaigns from anon, authenticated;

grant update (
  title,
  subject,
  subject_variants,
  preheader,
  from_name,
  reply_to,
  design,
  audience,
  audience_id,
  topic_id,
  updated_at
) on public.email_campaigns to authenticated;

-- Send now on a scheduled campaign is a fresh approval, so it reads the
-- live row rather than the snapshot — and has to clear it, or a 'sending'
-- row keeps a snapshot that says it is still waiting to go.
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
  v_variants integer;
  v_count    integer;
begin
  select gym_id, status, subject, audience, topic_id,
         1 + jsonb_array_length(coalesce(subject_variants, '[]'::jsonb))
    into v_gym, v_status, v_subject, v_audience, v_topic, v_variants
    from public.email_campaigns where id = p_campaign_id
    for update;
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
    (campaign_id, gym_id, profile_id, email, full_name, status, subject_variant)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued',
         (row_number() over (order by lower(r.email)) - 1) % v_variants
  from public.comms_audience_rows(v_gym, v_audience, v_topic) r
  on conflict (campaign_id, lower(email)) do nothing;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;
  if v_count = 0 then
    raise exception 'This audience has no members with a usable email address';
  end if;

  update public.email_campaigns
    set status             = 'sending',
        recipient_count    = v_count,
        compiled_html      = p_html,
        compiled_text      = p_text,
        scheduled_for      = null,
        scheduled_snapshot = null,
        updated_at         = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

grant execute on function public.comms_send_campaign(uuid, text, text)
  to authenticated;

commit;
