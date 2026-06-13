-- Communications Suite hardening + a wider effective_can fix.
--
-- 1. effective_can — was looking up a member's role without filtering on
--    left_at. A soft-deleted member retained capabilities; every staff
--    gate (comms, branding, plans, every can_* surface) trusted that
--    answer. Adding `left_at is null` to the role lookup is the single
--    upstream fix, and it removes the need to bolt left_at into each
--    individual policy / RPC. Code review of 0044 noticed this through
--    the email-assets storage policies — they delegated to
--    effective_can and assumed it gated on active membership, which it
--    didn't.
--
-- 2. comms_send_campaign — lock the campaign row before reading status
--    so two concurrent "Send" clicks can't both pass the draft/scheduled
--    check and proceed. The downstream insert handles dedup via the
--    (campaign_id, lower(email)) unique index, but the SELECT FOR
--    UPDATE makes the intent explicit.
--
-- 3. email_campaigns.compiled_html / .compiled_text — cap at 2 MB. A
--    runaway editor + base64-inlined image could otherwise drift into
--    multi-MB rows that bloat backups and break Resend's payload limit
--    silently.

begin;

-- ============================================================================
-- 1. effective_can: gate on active membership
-- ============================================================================

create or replace function public.effective_can(
  p_gym_id uuid,
  p_capability text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.gym_role;
  v_override boolean;
begin
  select role into v_role
    from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = auth.uid()
      and left_at is null;
  if v_role is null then
    return false;
  end if;
  if v_role = 'owner' then
    return true;
  end if;
  if v_role = 'member' then
    return false;
  end if;
  select enabled into v_override
    from public.gym_role_capabilities
    where gym_id = p_gym_id
      and role = v_role
      and capability = p_capability;
  if v_override is not null then
    return v_override;
  end if;
  return public.default_capability(v_role, p_capability);
end;
$$;

-- ============================================================================
-- 2. comms_send_campaign: lock the row to close the double-send race
-- ============================================================================

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
  v_count    integer;
begin
  -- FOR UPDATE serialises two concurrent "Send" clicks: only the
  -- second one sees the post-update 'sending' status, and bails on
  -- the status check below.
  select gym_id, status, subject, audience
    into v_gym, v_status, v_subject, v_audience
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
    (campaign_id, gym_id, profile_id, email, full_name, status)
  select p_campaign_id, v_gym, r.profile_id, r.email, r.full_name, 'queued'
  from public.comms_audience_rows(v_gym, v_audience) r
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

-- ============================================================================
-- 3. email_campaigns: size cap on compiled HTML / text
-- ============================================================================

alter table public.email_campaigns
  add constraint email_campaigns_compiled_html_size
    check (compiled_html is null or octet_length(compiled_html) <= 2097152),
  add constraint email_campaigns_compiled_text_size
    check (compiled_text is null or octet_length(compiled_text) <= 524288);

commit;
