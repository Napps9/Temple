-- Communications Suite — staff-authored email campaigns.
--
-- A Mailchimp-shaped surface inside Temple: owners / admins design an
-- email with a block-based builder, target an audience built from the
-- gym's own member data (cohorts, tags, hand-picked members), send it,
-- and read back per-recipient delivery + open / click analytics.
--
-- What this migration lands:
--
--   1. can_manage_comms capability (owner + admin default) — gates the
--      whole suite, mirrored in src/lib/can.ts.
--   2. gym_comms_settings — per-gym sender identity + CAN-SPAM footer.
--   3. email_audiences — reusable saved segments (definition jsonb).
--   4. email_campaigns — the email itself: subject, block `design`,
--      `audience` snapshot, lifecycle status, compiled HTML stored at
--      send time so the delivery worker doesn't need the renderer.
--   5. email_campaign_recipients — the per-send recipient snapshot +
--      delivery / engagement state. Source of truth for analytics.
--   6. email_events — append-only open / click / bounce / unsubscribe
--      log, written by the tracking edge function (service role).
--   7. email_assets — image library backing the editor (rows track the
--      `email-assets` storage bucket).
--   8. email_unsubscribes — per-gym suppression list; the audience
--      resolver always excludes it.
--   9. RPCs: comms_audience_count / _sample (live builder feedback),
--      comms_send_campaign (authorise + snapshot + stash compiled HTML),
--      comms_finalize_simulation (no-ESP fallback delivery),
--      comms_campaign_stats (analytics rollup).
--
-- Member email lives in auth.users, not profiles, so every path that
-- needs an address goes through a security-definer function gated on
-- can_manage_comms — the same trust boundary as can_see_email. Clients
-- never get raw member emails except via these authorised RPCs.

begin;

-- ============================================================================
-- 1. Register can_manage_comms in the server-side default matrix
-- ============================================================================
--
-- Mirror of src/lib/can.ts. Owner is short-circuited true inside
-- effective_can(); member short-circuited false. Only admin/coach/staff
-- defaults are meaningful here — comms is admin-only by default, an
-- owner can grant it to coach/staff via gym_role_capabilities.

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 2. gym_comms_settings — sender identity + compliance footer
-- ============================================================================
--
-- One row per gym. from_name / reply_to drive the envelope; the footer
-- fields satisfy CAN-SPAM ("a valid physical postal address"). All
-- nullable — the send path falls back to the gym name + a generic
-- footer when unset, so a gym can send before filling these in.

create table public.gym_comms_settings (
  gym_id               uuid primary key references public.gyms(id) on delete cascade,
  from_name            text,
  reply_to             text,
  footer_business_name text,
  footer_address       text,
  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now()
);

alter table public.gym_comms_settings enable row level security;

create policy gym_comms_settings_select on public.gym_comms_settings
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy gym_comms_settings_insert on public.gym_comms_settings
  for insert with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy gym_comms_settings_update on public.gym_comms_settings
  for update using (public.effective_can(gym_id, 'can_manage_comms'))
  with check (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 3. email_audiences — reusable saved segments
-- ============================================================================
--
-- `definition` is the same audience-jsonb shape the campaign carries
-- inline (see comms_audience_rows for the resolver): { kind, ... }.

create table public.email_audiences (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  definition  jsonb not null default '{"kind":"all_members"}'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index email_audiences_gym_idx on public.email_audiences (gym_id, created_at desc);

alter table public.email_audiences enable row level security;

create policy email_audiences_select on public.email_audiences
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_audiences_insert on public.email_audiences
  for insert with check (
    public.effective_can(gym_id, 'can_manage_comms') and created_by = auth.uid()
  );
create policy email_audiences_update on public.email_audiences
  for update using (public.effective_can(gym_id, 'can_manage_comms'))
  with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_audiences_delete on public.email_audiences
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 4. email_campaigns — the email
-- ============================================================================

create table public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  title           text not null default 'Untitled campaign',
  subject         text not null default '',
  preheader       text not null default '',
  from_name       text,
  reply_to        text,
  status          text not null default 'draft'
                    check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  -- Block document authored in the editor; rendered to HTML client-side.
  design          jsonb not null default '{"version":1,"blocks":[],"settings":{}}'::jsonb,
  -- Inline audience definition (a saved segment can be copied in here).
  audience        jsonb not null default '{"kind":"all_members"}'::jsonb,
  audience_id     uuid references public.email_audiences(id) on delete set null,
  -- Snapshotted at send so the delivery worker is renderer-free.
  compiled_html   text,
  compiled_text   text,
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index email_campaigns_gym_idx
  on public.email_campaigns (gym_id, created_at desc);
create index email_campaigns_gym_status_idx
  on public.email_campaigns (gym_id, status);

alter table public.email_campaigns enable row level security;

create policy email_campaigns_select on public.email_campaigns
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_campaigns_insert on public.email_campaigns
  for insert with check (
    public.effective_can(gym_id, 'can_manage_comms') and created_by = auth.uid()
  );
-- Drafts are edited freely. A campaign that has left draft/scheduled
-- (sending/sent/failed) is a historical record — the UI stops offering
-- edits, and this policy stops a stale client from mutating it.
create policy email_campaigns_update on public.email_campaigns
  for update using (
    public.effective_can(gym_id, 'can_manage_comms')
    and status in ('draft','scheduled')
  )
  with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_campaigns_delete on public.email_campaigns
  for delete using (
    public.effective_can(gym_id, 'can_manage_comms')
    and status in ('draft','scheduled','failed','cancelled')
  );

-- ============================================================================
-- 5. email_campaign_recipients — per-send snapshot + delivery state
-- ============================================================================

create table public.email_campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.email_campaigns(id) on delete cascade,
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  profile_id       uuid references public.profiles(id) on delete set null,
  email            text not null,
  full_name        text,
  status           text not null default 'queued'
                     check (status in ('queued','sent','delivered','simulated','bounced','failed','skipped')),
  error            text,
  provider_message_id text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  open_count       integer not null default 0,
  first_clicked_at timestamptz,
  last_clicked_at  timestamptz,
  click_count      integer not null default 0,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now()
);

-- One row per address per campaign (case-insensitive). The send snapshot
-- relies on this for its ON CONFLICT guard.
create unique index email_campaign_recipients_unique
  on public.email_campaign_recipients (campaign_id, lower(email));
create index email_campaign_recipients_campaign_idx
  on public.email_campaign_recipients (campaign_id, status);
create index email_campaign_recipients_gym_idx
  on public.email_campaign_recipients (gym_id);

alter table public.email_campaign_recipients enable row level security;

-- Read-only to staff. All writes go through the security-definer RPCs
-- below or the delivery / tracking edge functions (service role), so
-- there is deliberately no client insert/update/delete policy.
create policy email_campaign_recipients_select on public.email_campaign_recipients
  for select using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 6. email_events — append-only engagement log
-- ============================================================================

create table public.email_events (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  campaign_id  uuid not null references public.email_campaigns(id) on delete cascade,
  recipient_id uuid references public.email_campaign_recipients(id) on delete cascade,
  kind         text not null
                 check (kind in ('queued','sent','delivered','open','click','bounce','complaint','unsubscribe','failed','simulated')),
  url          text,
  meta         jsonb,
  occurred_at  timestamptz not null default now()
);

create index email_events_campaign_idx on public.email_events (campaign_id, kind);
create index email_events_gym_idx on public.email_events (gym_id, occurred_at desc);

alter table public.email_events enable row level security;

create policy email_events_select on public.email_events
  for select using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 7. email_assets — image library for the editor
-- ============================================================================

create table public.email_assets (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  path        text not null,
  url         text not null,
  file_name   text,
  byte_size   integer,
  created_at  timestamptz not null default now()
);

create index email_assets_gym_idx on public.email_assets (gym_id, created_at desc);

alter table public.email_assets enable row level security;

create policy email_assets_select on public.email_assets
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_assets_insert on public.email_assets
  for insert with check (
    public.effective_can(gym_id, 'can_manage_comms') and uploaded_by = auth.uid()
  );
create policy email_assets_delete on public.email_assets
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- Storage bucket for editor images. Files live under <gym_id>/<file> so
-- the write policies can verify the uploader manages comms for that gym.
-- Public read so email clients can fetch the image when the mail is
-- opened anywhere.
insert into storage.buckets (id, name, public)
  values ('email-assets', 'email-assets', true)
  on conflict (id) do nothing;

drop policy if exists email_assets_public_read  on storage.objects;
drop policy if exists email_assets_comms_insert on storage.objects;
drop policy if exists email_assets_comms_delete on storage.objects;

create policy email_assets_public_read on storage.objects
  for select using (bucket_id = 'email-assets');

-- Compare the folder segment as text (never cast to uuid — this policy
-- is evaluated for inserts to every bucket, and a non-uuid folder
-- elsewhere would error a cast). effective_can only ever sees a real
-- gym_id from the membership row.
create policy email_assets_comms_insert on storage.objects
  for insert with check (
    bucket_id = 'email-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_comms')
    )
  );

create policy email_assets_comms_delete on storage.objects
  for delete using (
    bucket_id = 'email-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_comms')
    )
  );

-- ============================================================================
-- 8. email_unsubscribes — per-gym suppression list
-- ============================================================================

create table public.email_unsubscribes (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  email       text not null,
  profile_id  uuid references public.profiles(id) on delete set null,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);

create unique index email_unsubscribes_unique
  on public.email_unsubscribes (gym_id, lower(email));

alter table public.email_unsubscribes enable row level security;

create policy email_unsubscribes_select on public.email_unsubscribes
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
-- Staff may add a manual suppression. Removal (re-subscribe) too. The
-- public unsubscribe link is handled by the tracking edge function with
-- the service role, not by this policy.
create policy email_unsubscribes_insert on public.email_unsubscribes
  for insert with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_unsubscribes_delete on public.email_unsubscribes
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 9. Audience resolver + RPCs
-- ============================================================================
--
-- comms_audience_rows is the single source of truth for "who does this
-- audience-jsonb resolve to". It reads member email from auth.users, so
-- it is SECURITY DEFINER and REVOKEd from PUBLIC — only the authorised
-- wrappers below (which check effective_can first) call it. Resolution
-- is always scoped to active members, dedup'd by lower(email), and the
-- gym's suppression list is always subtracted.
--
-- Audience definition shapes:
--   { "kind": "all_members" }
--   { "kind": "cohort",  "cohorts": ["intro","active","paying","expiring_soon","expired"] }
--   { "kind": "tags",    "tags": ["VIP","At risk"] }      -- ANY of
--   { "kind": "manual",  "profile_ids": ["<uuid>", ...] }

create or replace function public.comms_audience_rows(
  p_gym_id     uuid,
  p_definition jsonb
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select gm.profile_id
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.left_at is null
      and gm.role = 'member'
  ),
  selected as (
    select b.profile_id
    from base b
    where case coalesce(p_definition->>'kind', 'all_members')
      when 'all_members' then true
      when 'cohort' then exists (
        select 1 from public.v_member_cohort c
        where c.gym_id = p_gym_id and c.profile_id = b.profile_id
          and (
            ((p_definition->'cohorts') ? 'intro'         and c.is_intro)         or
            ((p_definition->'cohorts') ? 'active'        and c.is_active)        or
            ((p_definition->'cohorts') ? 'paying'        and c.is_paying)        or
            ((p_definition->'cohorts') ? 'expiring_soon' and c.is_expiring_soon) or
            ((p_definition->'cohorts') ? 'expired'       and c.is_expired)
          )
      )
      when 'tags' then exists (
        select 1 from public.member_tags mt
        where mt.gym_id = p_gym_id and mt.profile_id = b.profile_id
          and (p_definition->'tags') ? mt.label
      )
      when 'manual' then (p_definition->'profile_ids') ? b.profile_id::text
      else false
    end
  )
  select distinct on (lower(u.email))
    s.profile_id,
    p.full_name,
    u.email
  from selected s
  join public.profiles p on p.id = s.profile_id
  join auth.users u on u.id = s.profile_id
  where u.email is not null
    and length(trim(u.email)) > 0
    and not exists (
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id and lower(eu.email) = lower(u.email)
    )
  order by lower(u.email);
$$;

revoke all on function public.comms_audience_rows(uuid, jsonb) from public;

-- Live count for the audience builder.
create or replace function public.comms_audience_count(
  p_gym_id     uuid,
  p_definition jsonb
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  return (select count(*)::int from public.comms_audience_rows(p_gym_id, p_definition));
end;
$$;
grant execute on function public.comms_audience_count(uuid, jsonb) to authenticated;

-- Bounded preview ("first N recipients") for the builder.
create or replace function public.comms_audience_sample(
  p_gym_id     uuid,
  p_definition jsonb,
  p_limit      integer default 25
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  return query
    select * from public.comms_audience_rows(p_gym_id, p_definition)
    limit greatest(1, least(coalesce(p_limit, 25), 200));
end;
$$;
grant execute on function public.comms_audience_sample(uuid, jsonb, integer) to authenticated;

-- Authorise + snapshot recipients + stash the compiled HTML/text. Flips
-- the campaign to 'sending'; the delivery worker (edge function) or the
-- simulation finaliser takes it from there. Returns the recipient count.
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
  select gym_id, status, subject, audience
    into v_gym, v_status, v_subject, v_audience
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
grant execute on function public.comms_send_campaign(uuid, text, text) to authenticated;

-- No-ESP fallback: mark every queued recipient 'simulated' and close the
-- campaign out as 'sent'. Used in dev / when no sending domain is wired,
-- so the whole suite is demonstrable end-to-end. Deliberately records no
-- opens / clicks — a simulated send reached nobody, and fabricating
-- engagement would be a lie.
create or replace function public.comms_finalize_simulation(
  p_campaign_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym    uuid;
  v_status text;
  v_count  integer;
begin
  select gym_id, status into v_gym, v_status
    from public.email_campaigns where id = p_campaign_id;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  if v_status <> 'sending' then
    raise exception 'Campaign is not in sending state (%).', v_status;
  end if;

  update public.email_campaign_recipients
    set status = 'simulated', sent_at = now()
    where campaign_id = p_campaign_id and status = 'queued';

  insert into public.email_events (gym_id, campaign_id, recipient_id, kind)
  select v_gym, p_campaign_id, id, 'simulated'
    from public.email_campaign_recipients
    where campaign_id = p_campaign_id;

  select count(*)::int into v_count
    from public.email_campaign_recipients where campaign_id = p_campaign_id;

  update public.email_campaigns
    set status = 'sent', sent_at = now(), updated_at = now()
    where id = p_campaign_id;

  return v_count;
end;
$$;
grant execute on function public.comms_finalize_simulation(uuid) to authenticated;

-- Analytics rollup for one campaign. Recomputed from the recipient table
-- so it never drifts from the per-recipient truth.
create or replace function public.comms_campaign_stats(
  p_campaign_id uuid
) returns table (
  recipients   integer,
  sent         integer,
  delivered    integer,
  simulated    integer,
  failed       integer,
  bounced      integer,
  opened       integer,
  clicked      integer,
  unsubscribed integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.email_campaigns where id = p_campaign_id;
  if v_gym is null then
    raise exception 'Campaign not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where status in ('sent','delivered','simulated'))::int,
    count(*) filter (where status = 'delivered')::int,
    count(*) filter (where status = 'simulated')::int,
    count(*) filter (where status = 'failed')::int,
    count(*) filter (where status = 'bounced')::int,
    count(*) filter (where first_opened_at is not null)::int,
    count(*) filter (where first_clicked_at is not null)::int,
    count(*) filter (where unsubscribed_at is not null)::int
  from public.email_campaign_recipients
  where campaign_id = p_campaign_id;
end;
$$;
grant execute on function public.comms_campaign_stats(uuid) to authenticated;

-- Engagement recorder for the public tracking endpoint (open pixel /
-- click redirect / unsubscribe). Called by the `track` edge function
-- with the service role. The recipient id in the tracking URL is an
-- unguessable uuid — the standard capability-URL model every email open
-- pixel relies on — so this is granted broadly but only ever mutates the
-- one recipient the id points at, and only its engagement columns.
--
-- A click or open also proves delivery, so a still-'sent' recipient is
-- promoted to 'delivered'. Increments are done in-statement so two
-- opens racing don't clobber each other's count.
create or replace function public.comms_track_event(
  p_campaign_id uuid,
  p_recipient_id uuid,
  p_kind text,
  p_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     uuid;
  v_profile uuid;
  v_email   text;
begin
  select gym_id, profile_id, email
    into v_gym, v_profile, v_email
    from public.email_campaign_recipients
    where id = p_recipient_id and campaign_id = p_campaign_id;
  if v_gym is null then
    return; -- unknown recipient / mismatched campaign: silently ignore
  end if;

  if p_kind = 'open' then
    update public.email_campaign_recipients
      set open_count      = open_count + 1,
          last_opened_at   = now(),
          first_opened_at  = coalesce(first_opened_at, now()),
          status           = case when status in ('queued','sent') then 'delivered' else status end
      where id = p_recipient_id;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind)
      values (v_gym, p_campaign_id, p_recipient_id, 'open');

  elsif p_kind = 'click' then
    update public.email_campaign_recipients
      set click_count      = click_count + 1,
          last_clicked_at   = now(),
          first_clicked_at  = coalesce(first_clicked_at, now()),
          first_opened_at   = coalesce(first_opened_at, now()),
          status            = case when status in ('queued','sent') then 'delivered' else status end
      where id = p_recipient_id;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, url)
      values (v_gym, p_campaign_id, p_recipient_id, 'click', p_url);

  elsif p_kind = 'unsubscribe' then
    update public.email_campaign_recipients
      set unsubscribed_at = coalesce(unsubscribed_at, now())
      where id = p_recipient_id;
    insert into public.email_unsubscribes (gym_id, email, profile_id, campaign_id)
      values (v_gym, v_email, v_profile, p_campaign_id)
      on conflict (gym_id, lower(email)) do nothing;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind)
      values (v_gym, p_campaign_id, p_recipient_id, 'unsubscribe');

  else
    raise exception 'Unknown tracking event kind: %', p_kind;
  end if;
end;
$$;

grant execute on function public.comms_track_event(uuid, uuid, text, text)
  to anon, authenticated, service_role;

commit;
