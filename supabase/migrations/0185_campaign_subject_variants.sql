-- A/B subject testing.
--
-- The only one of the four comms gaps that needs a new data model — the
-- picker, saved segments and scheduling were all substrate waiting for a
-- UI. Here there is genuinely nowhere to put a second subject line, and
-- nowhere to record which recipient got which.
--
-- Shape: variants live on the campaign as a jsonb array rather than their
-- own table. They are always read with the campaign, never queried across
-- campaigns, and capped at a handful — the same reasoning that keeps
-- email_campaigns.design as jsonb.
--
-- Assignment happens once, at recipient-snapshot time, and is stored per
-- recipient. Deciding at send time instead would re-roll on a retry and
-- put two different subjects in front of the same person.
--
-- Splitting is deterministic on the recipient row's position rather than
-- random: an even split of a small list is what a gym expects from "50/50",
-- and random assignment on 40 recipients routinely lands 26/14.

begin;

alter table public.email_campaigns
  add column subject_variants jsonb not null default '[]'::jsonb,
  add constraint email_campaigns_subject_variants_shape
    check (jsonb_typeof(subject_variants) = 'array'
           and jsonb_array_length(subject_variants) <= 4);

alter table public.email_campaign_recipients
  add column subject_variant integer;

comment on column public.email_campaigns.subject_variants is
  'Extra subject lines to test against email_campaigns.subject, which is '
  'always variant 0. Max 4 total.';

-- ============================================================================
-- Assignment at snapshot time
-- ============================================================================
--
-- Body is 0182's verbatim apart from the variant column: same lock, same
-- guards, same audience call.

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
    set status          = 'sending',
        recipient_count = v_count,
        compiled_html   = p_html,
        compiled_text   = p_text,
        scheduled_for   = null,
        updated_at      = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;

-- Same for the cron path.
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
  v_variants integer;
  v_count    integer;
begin
  select gym_id, status, audience, topic_id,
         1 + jsonb_array_length(coalesce(subject_variants, '[]'::jsonb))
    into v_gym, v_status, v_audience, v_topic, v_variants
    from public.email_campaigns where id = p_campaign_id
    for update;
  if v_gym is null or v_status <> 'scheduled' then
    return 0;
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

-- ============================================================================
-- Which one won
-- ============================================================================
--
-- Open rate, because that is the only thing a subject line can move. A
-- click rate difference between two subjects is a difference in who
-- opened, measured twice.

create or replace function public.comms_variant_stats(p_campaign_id uuid)
returns table (
  variant    integer,
  subject    text,
  recipients integer,
  delivered  integer,
  opened     integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_gym      uuid;
  v_subject  text;
  v_variants jsonb;
begin
  -- Qualified: the RETURNS TABLE column `subject` shadows the table's.
  select ec.gym_id, ec.subject, coalesce(ec.subject_variants, '[]'::jsonb)
    into v_gym, v_subject, v_variants
    from public.email_campaigns ec where ec.id = p_campaign_id;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;

  return query
  select
    coalesce(r.subject_variant, 0),
    case when coalesce(r.subject_variant, 0) = 0 then v_subject
         else v_variants->>(coalesce(r.subject_variant, 0) - 1) end,
    count(*)::int,
    count(*) filter (where r.status in ('sent', 'delivered', 'simulated'))::int,
    count(*) filter (where r.first_opened_at is not null)::int
  from public.email_campaign_recipients r
  where r.campaign_id = p_campaign_id
  group by 1, 2
  order by 1;
end;
$$;

grant execute on function public.comms_variant_stats(uuid) to authenticated;

commit;
