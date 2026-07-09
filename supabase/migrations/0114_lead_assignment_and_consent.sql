-- Phase 4a — lead-to-coach automation.
--
-- The leads foundation (0056/0064) captures prospects and moves them
-- through a funnel, but nothing happens automatically when a lead lands:
-- no coach is assigned, nobody is notified, no delivery is recorded, and
-- there is no consent/lawful-basis on the record. Gyms currently bridge
-- that gap with a booking tool + GoHighLevel + a PT app. This migration
-- brings the capture -> assignment -> notification loop in-house.
--
-- Design rules (deliberate, non-negotiable):
--   - Deterministic, rules-only. No cleverness — round-robin by default.
--   - Invisible by default. Zero config needed: absence of a rules row
--     means "round-robin across active coaches". A gym never has to build
--     a flowchart to get "New lead assigned to Sarah".
--   - Reliability over features. Every notification attempt is logged in
--     lead_notifications (the backbone). Failures are visible + retryable.
--     Enqueue is idempotent so a retry never double-fires.
--   - GDPR-first. Marketing consent + lawful basis captured on the lead;
--     a configurable retention window; a purge sweep for unconverted
--     leads (converted ones became members and live under member rules).
--
-- Postgres never makes outbound HTTP here (no pg_net, by convention). The
-- in-app notification IS the row we insert, delivered instantly. The email
-- is enqueued 'queued' and drained by the send-lead-notifications edge
-- function, invoked best-effort by the client after capture and retryable
-- from the owner screen — mirroring the send-campaign pattern (0044).

begin;

-- ============================================================================
-- 1. leads: assignment + consent columns
-- ============================================================================
--
-- lawful_basis defaults to 'legitimate_interest': a prospect who asks a
-- gym to contact them creates a lawful record regardless of marketing
-- opt-in. marketing_consent is the separate, explicit opt-in for future
-- marketing (mirrors member_consents in 0037).

alter table public.leads
  add column if not exists assigned_coach_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists consent_at timestamptz,
  add column if not exists lawful_basis text not null default 'legitimate_interest',
  add column if not exists consent_policy_version text;

create index if not exists leads_assigned_idx
  on public.leads(gym_id, assigned_coach_id)
  where assigned_coach_id is not null;

-- ============================================================================
-- 2. lead_assignment_rules — optional, per-gym. Absence = round_robin.
-- ============================================================================

create table public.lead_assignment_rules (
  gym_id          uuid primary key references public.gyms(id) on delete cascade,
  strategy        text not null default 'round_robin'
                    check (strategy in ('round_robin', 'single_default', 'manual')),
  default_coach_id uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

alter table public.lead_assignment_rules enable row level security;

create policy lead_assignment_rules_tenant_select on public.lead_assignment_rules
  for select using (public.user_can_assign_plan(gym_id));
create policy lead_assignment_rules_owner_write on public.lead_assignment_rules
  for all using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 3. lead_notifications — the reliability backbone (audit log + queue)
-- ============================================================================
--
-- One row per notification attempt per channel. in_app rows are written
-- 'sent' (the row is the notification). email/sms rows start 'queued' and
-- are drained by the edge worker. idempotency_key makes enqueue safe to
-- re-run: a retry or a re-assignment to the same coach never duplicates.

create table public.lead_notifications (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  lead_id              uuid not null references public.leads(id) on delete cascade,
  channel              text not null check (channel in ('email', 'in_app', 'sms')),
  recipient            text,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  status               text not null default 'queued'
                         check (status in ('queued', 'sent', 'failed', 'skipped', 'read')),
  error                text,
  idempotency_key      text not null unique,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  read_at              timestamptz
);

create index lead_notifications_gym_status_idx
  on public.lead_notifications(gym_id, status);
create index lead_notifications_lead_idx
  on public.lead_notifications(lead_id);
create index lead_notifications_inbox_idx
  on public.lead_notifications(recipient_profile_id, status)
  where channel = 'in_app';

alter table public.lead_notifications enable row level security;

-- Staff can read their gym's notification log. There is no client
-- insert/update policy: rows are written only by the security-definer RPCs
-- below and the service-role edge worker. The "mark read" and "requeue"
-- paths are RPCs, not direct writes.
create policy lead_notifications_tenant_select on public.lead_notifications
  for select using (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- 4. gyms: SMS flag (seam) + retention window
-- ============================================================================

alter table public.gyms
  add column if not exists lead_sms_enabled boolean not null default false,
  add column if not exists lead_retention_days integer not null default 365;

create or replace function public.set_gym_lead_sms(
  p_gym_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change lead SMS';
  end if;
  update public.gyms set lead_sms_enabled = p_enabled where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_lead_sms(uuid, boolean) to authenticated;

create or replace function public.set_gym_lead_retention(
  p_gym_id uuid, p_days integer
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change lead retention';
  end if;
  if p_days is null or p_days < 30 then
    raise exception 'Retention must be at least 30 days';
  end if;
  update public.gyms set lead_retention_days = p_days where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_lead_retention(uuid, integer) to authenticated;

-- ============================================================================
-- 5. Assignment rules setter (owner-only)
-- ============================================================================

create or replace function public.set_lead_assignment_rule(
  p_gym_id          uuid,
  p_strategy        text,
  p_default_coach_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change lead assignment';
  end if;
  if p_strategy not in ('round_robin', 'single_default', 'manual') then
    raise exception 'Unknown assignment strategy';
  end if;
  -- Cross-tenant guard: a default coach must be a current member of this gym.
  if p_default_coach_id is not null and not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_default_coach_id
      and left_at is null
  ) then
    raise exception 'Default coach is not a member of this gym';
  end if;

  insert into public.lead_assignment_rules
    (gym_id, strategy, default_coach_id, updated_at, updated_by)
  values (p_gym_id, p_strategy, p_default_coach_id, now(), auth.uid())
  on conflict (gym_id) do update
    set strategy = excluded.strategy,
        default_coach_id = excluded.default_coach_id,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;
grant execute on function public.set_lead_assignment_rule(uuid, text, uuid)
  to authenticated;

-- ============================================================================
-- 6. enqueue_lead_notifications — internal; writes the audit/queue rows
-- ============================================================================
--
-- p_reason lets a manual nudge force a fresh send (distinct idempotency
-- key) while an automatic (re)assignment stays deduped per (lead, coach).

create or replace function public.enqueue_lead_notifications(
  p_lead_id  uuid,
  p_coach_id uuid,
  p_reason   text default 'assigned'
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym   uuid;
  v_email text;
  v_sms   boolean;
  v_key_suffix text := case when p_reason = 'assigned' then '' else ':' || p_reason end;
begin
  if p_coach_id is null then
    return;
  end if;
  select l.gym_id, g.lead_sms_enabled
    into v_gym, v_sms
    from public.leads l
    join public.gyms g on g.id = l.gym_id
    where l.id = p_lead_id;
  if v_gym is null then
    return;
  end if;

  select u.email into v_email from auth.users u where u.id = p_coach_id;

  -- In-app: delivered instantly — the row IS the notification.
  insert into public.lead_notifications
    (gym_id, lead_id, channel, recipient, recipient_profile_id, status, sent_at, idempotency_key)
  values
    (v_gym, p_lead_id, 'in_app', p_coach_id::text, p_coach_id, 'sent', now(),
     'in_app:' || p_lead_id || ':' || p_coach_id || v_key_suffix)
  on conflict (idempotency_key) do nothing;

  -- Email: queued for the edge worker to drain. No email address means we
  -- can't send — record it as skipped so it's visible, not silently lost.
  insert into public.lead_notifications
    (gym_id, lead_id, channel, recipient, recipient_profile_id, status, error, idempotency_key)
  values
    (v_gym, p_lead_id, 'email', v_email, p_coach_id,
     case when v_email is null then 'skipped' else 'queued' end,
     case when v_email is null then 'Coach has no email address' else null end,
     'email:' || p_lead_id || ':' || p_coach_id || v_key_suffix)
  on conflict (idempotency_key) do nothing;

  -- SMS is a seam: only enqueued when the gym has opted in. The worker
  -- stubs it as skipped until a provider is wired.
  if v_sms then
    insert into public.lead_notifications
      (gym_id, lead_id, channel, recipient, recipient_profile_id, status, idempotency_key)
    values
      (v_gym, p_lead_id, 'sms',
       (select phone from public.leads where id = p_lead_id), p_coach_id, 'queued',
       'sms:' || p_lead_id || ':' || p_coach_id || v_key_suffix)
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;
revoke execute on function public.enqueue_lead_notifications(uuid, uuid, text)
  from public, anon, authenticated;

-- ============================================================================
-- 7. assign_lead — deterministic, least-loaded round-robin
-- ============================================================================
--
-- Returns the chosen coach (or null when the rule is 'manual' / no staff
-- exist). Per-gym advisory lock serialises concurrent captures so two
-- simultaneous leads don't both pick the same "least loaded" coach.

create or replace function public.assign_lead(p_lead_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_existing uuid;
  v_strategy text := 'round_robin';
  v_default  uuid;
  v_coach    uuid;
begin
  select gym_id, assigned_coach_id into v_gym, v_existing
    from public.leads where id = p_lead_id;
  if v_gym is null then
    return null;
  end if;

  -- Idempotent: a lead that already has an assignee keeps them. Re-running
  -- only re-enqueues (which dedups) rather than re-balancing to someone
  -- else and firing a second notification. Reassignment is an explicit act
  -- via set_lead_assignee.
  if v_existing is not null then
    perform public.enqueue_lead_notifications(p_lead_id, v_existing, 'assigned');
    return v_existing;
  end if;

  perform pg_advisory_xact_lock(hashtext('lead_assign:' || v_gym::text));

  select strategy, default_coach_id into v_strategy, v_default
    from public.lead_assignment_rules where gym_id = v_gym;
  v_strategy := coalesce(v_strategy, 'round_robin');

  if v_strategy = 'manual' then
    return null;
  end if;

  if v_strategy = 'single_default' and v_default is not null and exists (
    select 1 from public.gym_memberships
    where gym_id = v_gym and profile_id = v_default and left_at is null
  ) then
    v_coach := v_default;
  end if;

  -- round_robin (also the fallback when single_default's coach has left):
  -- the active coach carrying the fewest open leads, tie-broken by who has
  -- gone longest without a handoff, then by id for a stable order.
  if v_coach is null then
    select gm.profile_id into v_coach
      from public.gym_memberships gm
      where gm.gym_id = v_gym and gm.role = 'coach' and gm.left_at is null
      order by
        (select count(*) from public.leads l
           where l.gym_id = v_gym and l.assigned_coach_id = gm.profile_id
             and l.status not in ('converted', 'lost')) asc,
        (select coalesce(max(l2.assigned_at), 'epoch'::timestamptz)
           from public.leads l2
           where l2.gym_id = v_gym and l2.assigned_coach_id = gm.profile_id) asc,
        gm.profile_id asc
      limit 1;
  end if;

  -- No active coach at all: fall back to an owner/admin so the lead is
  -- still handed to a human. A dropped lead is worse than an odd one.
  if v_coach is null then
    select gm.profile_id into v_coach
      from public.gym_memberships gm
      where gm.gym_id = v_gym and gm.role in ('owner', 'admin') and gm.left_at is null
      order by gm.role, gm.profile_id
      limit 1;
  end if;

  if v_coach is null then
    return null; -- captured but unassigned; visible in the owner funnel.
  end if;

  update public.leads
    set assigned_coach_id = v_coach, assigned_at = now()
    where id = p_lead_id;

  perform public.enqueue_lead_notifications(p_lead_id, v_coach, 'assigned');
  return v_coach;
end;
$$;
-- Callable by authenticated staff surfaces (guarded by the RPCs that wrap
-- it), and by the security-definer capture RPCs. Not for anon directly.
revoke execute on function public.assign_lead(uuid) from public, anon;
grant execute on function public.assign_lead(uuid) to authenticated;

-- ============================================================================
-- 8. set_lead_assignee — manual reassign (staff)
-- ============================================================================

create or replace function public.set_lead_assignee(
  p_lead_id  uuid,
  p_coach_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.leads where id = p_lead_id;
  if v_gym is null then
    raise exception 'Lead not found';
  end if;
  if not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised';
  end if;
  -- Cross-tenant guard: the coach must belong to this gym.
  if p_coach_id is not null and not exists (
    select 1 from public.gym_memberships
    where gym_id = v_gym and profile_id = p_coach_id and left_at is null
  ) then
    raise exception 'Coach is not a member of this gym';
  end if;

  update public.leads
    set assigned_coach_id = p_coach_id,
        assigned_at = case when p_coach_id is null then null else now() end
    where id = p_lead_id;

  if p_coach_id is not null then
    perform public.enqueue_lead_notifications(p_lead_id, p_coach_id, 'assigned');
  end if;
end;
$$;
grant execute on function public.set_lead_assignee(uuid, uuid) to authenticated;

-- ============================================================================
-- 9. nudge_lead — re-notify the current assignee (stale-lead follow-up)
-- ============================================================================

create or replace function public.nudge_lead(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym   uuid;
  v_coach uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id, assigned_coach_id into v_gym, v_coach
    from public.leads where id = p_lead_id;
  if v_gym is null then
    raise exception 'Lead not found';
  end if;
  if not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised';
  end if;
  if v_coach is null then
    raise exception 'Lead has no assignee to nudge';
  end if;
  -- A date-stamped reason makes each day's nudge a distinct send while
  -- still coalescing accidental double-taps within the same day.
  perform public.enqueue_lead_notifications(
    p_lead_id, v_coach, 'nudge:' || to_char(now(), 'YYYY-MM-DD'));
end;
$$;
grant execute on function public.nudge_lead(uuid) to authenticated;

-- ============================================================================
-- 10. Notification read + requeue RPCs
-- ============================================================================

create or replace function public.mark_lead_notification_read(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.lead_notifications
    set status = 'read', read_at = now()
    where id = p_id
      and channel = 'in_app'
      and recipient_profile_id = auth.uid()
      and status <> 'read';
end;
$$;
grant execute on function public.mark_lead_notification_read(uuid) to authenticated;

create or replace function public.requeue_lead_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.lead_notifications where id = p_id;
  if v_gym is null then
    raise exception 'Notification not found';
  end if;
  if not public.user_can_assign_plan(v_gym) then
    raise exception 'Not authorised';
  end if;
  update public.lead_notifications
    set status = 'queued', error = null
    where id = p_id and channel in ('email', 'sms') and status = 'failed';
end;
$$;
grant execute on function public.requeue_lead_notification(uuid) to authenticated;

-- ============================================================================
-- 11. count_unread_lead_notifications — drives the assignee's nav badge
-- ============================================================================

create or replace function public.count_unread_lead_notifications(p_gym_id uuid)
returns integer
language sql security definer stable set search_path = public
as $$
  select count(*)::int
    from public.lead_notifications
    where gym_id = p_gym_id
      and channel = 'in_app'
      and recipient_profile_id = auth.uid()
      and status = 'sent';
$$;
grant execute on function public.count_unread_lead_notifications(uuid) to authenticated;

-- ============================================================================
-- 12. purge_expired_leads — retention sweep (internal; scheduled in 0115)
-- ============================================================================
--
-- Deletes unconverted leads past their gym's retention window. Converted
-- leads are kept — they became members and are governed by member data
-- rules. lead_notifications rows cascade with the lead.

create or replace function public.purge_expired_leads()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.leads l
      using public.gyms g
      where g.id = l.gym_id
        and l.converted_profile_id is null
        and l.captured_at < now() - make_interval(days => g.lead_retention_days)
      returning l.id
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_leads() from public, anon, authenticated;

-- ============================================================================
-- 13. Wire assignment into the capture paths
-- ============================================================================

-- record_lead: same signature, now auto-assigns after insert.
create or replace function public.record_lead(
  p_gym_id    uuid,
  p_full_name text,
  p_email     text default null,
  p_phone     text default null,
  p_source_id uuid default null,
  p_notes     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;
  -- Cross-tenant guard on source (0067 pattern).
  if p_source_id is not null and not exists (
    select 1 from public.lead_sources where id = p_source_id and gym_id = p_gym_id
  ) then
    raise exception 'Lead source does not belong to this gym';
  end if;

  insert into public.leads
    (gym_id, full_name, email, phone, source_id, notes, captured_by)
  values
    (p_gym_id, btrim(p_full_name),
     nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_phone, '')), ''),
     p_source_id, p_notes, v_uid)
  returning id into v_id;

  perform public.assign_lead(v_id);
  return v_id;
end;
$$;
grant execute on function public.record_lead(uuid, text, text, text, uuid, text)
  to authenticated;

-- capture_public_lead: signature changes (adds p_marketing_consent), so
-- DROP + CREATE per the 0064 gym_by_slug precedent. Auto-assigns on both
-- the fresh-insert and dedup-refresh branches.
drop function if exists public.capture_public_lead(text, text, text, text, text);

create function public.capture_public_lead(
  p_slug              text,
  p_full_name         text,
  p_email             text,
  p_phone             text default null,
  p_message           text default null,
  p_marketing_consent boolean default false
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym       uuid;
  v_enabled   boolean;
  v_email     text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_name      text := btrim(coalesce(p_full_name, ''));
  v_existing  uuid;
  v_new       uuid;
begin
  select id, public_lead_capture_enabled
    into v_gym, v_enabled
    from public.gyms
    where slug = lower(p_slug);
  if v_gym is null then
    raise exception 'Gym not found';
  end if;
  if not coalesce(v_enabled, false) then
    raise exception 'This gym is not accepting enquiries right now';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if v_email is not null then
    select id into v_existing
      from public.leads
      where gym_id = v_gym
        and lower(email) = v_email
        and status not in ('converted'::public.lead_status, 'lost'::public.lead_status)
        and captured_at >= now() - interval '30 days'
      order by captured_at desc
      limit 1;
  end if;

  if v_existing is not null then
    update public.leads
      set phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
          notes = case
            when nullif(btrim(coalesce(p_message, '')), '') is null then notes
            when notes is null then p_message
            else notes || E'\n— ' || p_message
          end,
          -- Never downgrade an existing opt-in; only ever raise it.
          marketing_consent = marketing_consent or coalesce(p_marketing_consent, false),
          consent_at = case
            when coalesce(p_marketing_consent, false) and consent_at is null then now()
            else consent_at
          end,
          updated_at = now()
      where id = v_existing;
    -- Re-assign only if it slipped through unassigned (self-healing);
    -- enqueue is idempotent so an already-assigned lead won't re-notify.
    perform public.assign_lead(v_existing);
    return;
  end if;

  insert into public.leads
    (gym_id, full_name, email, phone, notes, status, captured_by,
     marketing_consent, consent_at, lawful_basis, consent_policy_version)
  values
    (v_gym, v_name, v_email,
     nullif(btrim(coalesce(p_phone, '')), ''),
     nullif(btrim(coalesce(p_message, '')), ''),
     'cold'::public.lead_status, null,
     coalesce(p_marketing_consent, false),
     case when coalesce(p_marketing_consent, false) then now() else null end,
     'legitimate_interest',
     case when coalesce(p_marketing_consent, false) then 'lead-capture-2026-07' else null end)
  returning id into v_new;

  perform public.assign_lead(v_new);
end;
$$;
grant execute on function public.capture_public_lead(text, text, text, text, text, boolean)
  to anon, authenticated;

commit;
