-- The scheduled banner promises more than the code delivers.
--
-- 0183 compiles the document at schedule time on purpose, and says so in
-- its own comment: "what goes out has to be what was approved when the
-- button was pressed". The editor tells the sender the same thing —
-- "Edits after this point will not go out — the version you scheduled is
-- the version that sends."
--
-- Only the document is frozen. email_campaigns_update permits UPDATE for
-- status in (draft, scheduled), the editor autosaves on a debounce, and
-- _send_due_campaign reads subject, subject_variants, audience and
-- topic_id off the live row at send time. So a scheduled campaign goes
-- out with the approved body under a subject line nobody approved, to an
-- audience nobody approved — and the sender was told in as many words
-- that it would not.
--
-- Freezing the rest by locking the row is the wrong shape here: the
-- editor autosaves, so a draft-only UPDATE policy would turn every
-- keystroke on a scheduled campaign into a permission error. The promise
-- on screen is the good design — keep editing, we send what you
-- approved — so this snapshots the remaining fields the way 0183
-- snapshots the document.
--
-- Backfilled for campaigns already scheduled, since the dispatcher only
-- started reaching its worker this morning and anything sitting in the
-- queue predates the column.

begin;

alter table public.email_campaigns
  add column if not exists scheduled_snapshot jsonb;

comment on column public.email_campaigns.scheduled_snapshot is
  'Subject, variants, audience and topic as they were when the campaign '
  'was scheduled. Null unless status = scheduled. _send_due_campaign '
  'reads these rather than the live columns, which stay editable.';

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

  update public.email_campaigns c
    set status        = 'scheduled',
        scheduled_for = p_send_at,
        compiled_html = p_html,
        compiled_text = p_text,
        scheduled_snapshot = jsonb_build_object(
          'subject',          c.subject,
          'subject_variants', c.subject_variants,
          'audience',         c.audience,
          'topic_id',         c.topic_id
        ),
        updated_at    = now()
    where c.id = p_campaign_id;
end;
$$;

grant execute on function public.comms_schedule_campaign(
  uuid, timestamptz, text, text) to authenticated;

-- Back to draft means back to editable in every sense, so the snapshot
-- goes with the schedule rather than lingering to be picked up by a
-- later, differently-approved send.
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
    set status = 'draft', scheduled_for = null, scheduled_snapshot = null,
        updated_at = now()
    where id = p_campaign_id;
end;
$$;

grant execute on function public.comms_unschedule_campaign(uuid)
  to authenticated;

update public.email_campaigns c
  set scheduled_snapshot = jsonb_build_object(
        'subject',          c.subject,
        'subject_variants', c.subject_variants,
        'audience',         c.audience,
        'topic_id',         c.topic_id)
  where c.status = 'scheduled' and c.scheduled_snapshot is null;

create or replace function public._send_due_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym      uuid;
  v_status   text;
  v_snap     jsonb;
  v_audience jsonb;
  v_topic    uuid;
  v_subject  text;
  v_variants integer;
  v_count    integer;
begin
  select gym_id, status, scheduled_snapshot
    into v_gym, v_status, v_snap
    from public.email_campaigns where id = p_campaign_id
    for update;
  if v_gym is null or v_status <> 'scheduled' then
    return 0;
  end if;

  v_audience := v_snap -> 'audience';
  v_topic    := nullif(v_snap ->> 'topic_id', '')::uuid;
  v_subject  := v_snap ->> 'subject';
  v_variants := 1 + jsonb_array_length(
    coalesce(v_snap -> 'subject_variants', '[]'::jsonb));

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, full_name, status, subject_variant)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued',
         (row_number() over (order by lower(r.email)) - 1) % v_variants
  from public.comms_audience_rows(v_gym, v_audience, v_topic) r
  on conflict (campaign_id, lower(email)) do nothing;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;

  if v_count = 0 then
    update public.email_campaigns
      set status = 'failed', updated_at = now()
      where id = p_campaign_id;
    return 0;
  end if;

  -- The approved subject is written back onto the row the worker and the
  -- report both read, so an edit made after scheduling does not retitle
  -- a send that already went out under the old one.
  update public.email_campaigns
    set status           = 'sending',
        subject          = coalesce(v_subject, subject),
        subject_variants = coalesce(v_snap -> 'subject_variants',
                                    subject_variants),
        recipient_count  = v_count,
        scheduled_for    = null,
        updated_at       = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

revoke execute on function public._send_due_campaign(uuid)
  from public, anon, authenticated;

commit;
