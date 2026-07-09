-- Phase 4b — owner-configurable email automations.
--
-- The Communications Suite (0044+) is broadcast-only: every send is a human
-- hitting "Send". This adds event-triggered automations an owner configures
-- once — "3 days after joining, welcome them", "a day after their first
-- class, follow up", "win back a member who's gone quiet", "nurture a lead
-- that's still cold" — and the platform fires them unattended.
--
-- There is no event bus in this codebase (audit_events was never built), so
-- the engine is a pg_cron polling sweep (0117) that scans source tables by
-- timestamp and enqueues due sends, drained by the send-email-automations
-- edge worker. This mirrors two established patterns: the security-monitor
-- firing model (0111/0112 — pg_cron -> a security-definer function ->
-- net.http_post to an edge function, URL + secret from GUCs, skipped when
-- unset) and the queue-row + idempotency-key + retryable-worker delivery
-- model (send-lead-notifications, 0114).
--
-- Reuse, not fork: recipient resolution + per-topic/blanket suppression go
-- through comms_audience_rows (0059); the sender identity, sending domain,
-- unsubscribe model and can_manage_comms gate are all the Comms Suite's.
-- Everything is gated on effective_can(gym_id, 'can_manage_comms') — owners
-- always pass, so owners can configure automations out of the box.

begin;

-- ============================================================================
-- 1. email_automations — the owner-configured rule
-- ============================================================================
--
-- design/compiled_html mirror email_campaigns: the block document plus the
-- HTML snapshot rendered client-side on save (there's no human at fire time
-- to compile, so we compile ahead). params holds the one trigger-specific
-- knob (delay is separate): {"inactive_days":21} / {"cold_hours":24}.

create table public.email_automations (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  name          text not null default 'Untitled automation',
  enabled       boolean not null default false,
  trigger_type  text not null default 'member_joined'
                  check (trigger_type in
                    ('member_joined', 'member_first_class', 'member_inactive', 'lead_cold')),
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  params        jsonb not null default '{}'::jsonb,
  topic_id      uuid references public.gym_email_topics(id) on delete set null,
  subject       text not null default '',
  preheader     text not null default '',
  from_name     text,
  design        jsonb not null default '{"version":1,"blocks":[],"settings":{}}'::jsonb,
  compiled_html text check (compiled_html is null or octet_length(compiled_html) <= 2 * 1024 * 1024),
  compiled_text text check (compiled_text is null or octet_length(compiled_text) <= 512 * 1024),
  created_by    uuid references public.profiles(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index email_automations_gym_idx on public.email_automations (gym_id, created_at desc);
create index email_automations_enabled_idx on public.email_automations (gym_id) where enabled;

alter table public.email_automations enable row level security;

create policy email_automations_select on public.email_automations
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_automations_insert on public.email_automations
  for insert with check (
    public.effective_can(gym_id, 'can_manage_comms') and created_by = auth.uid());
create policy email_automations_update on public.email_automations
  for update using (public.effective_can(gym_id, 'can_manage_comms'))
  with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_automations_delete on public.email_automations
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- Keep updated_at fresh and stop a cross-tenant topic from being attached
-- (edits are direct RLS table writes, so this guard lives in a trigger).
create or replace function public._email_automations_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.topic_id is not null and not exists (
    select 1 from public.gym_email_topics t
    where t.id = new.topic_id and t.gym_id = new.gym_id
  ) then
    raise exception 'Topic does not belong to this gym';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_automations_touch_trg
  before insert or update on public.email_automations
  for each row execute function public._email_automations_touch();

-- ============================================================================
-- 2. email_automation_runs — fired-ledger + queue + audit
-- ============================================================================
--
-- One row per (automation, subject) send attempt. idempotency_key is the
-- once-only guarantee: an insert conflict means "already fired". The worker
-- drains queued rows and writes status back.

create table public.email_automation_runs (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  automation_id      uuid not null references public.email_automations(id) on delete cascade,
  subject_profile_id uuid references public.profiles(id) on delete set null,
  lead_id            uuid references public.leads(id) on delete set null,
  recipient_email    text not null,
  recipient_name     text,
  status             text not null default 'queued'
                       check (status in ('queued', 'sent', 'failed', 'skipped', 'suppressed')),
  error              text,
  idempotency_key    text not null unique,
  scheduled_at       timestamptz,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create index email_automation_runs_gym_status_idx
  on public.email_automation_runs (gym_id, status);
create index email_automation_runs_automation_idx
  on public.email_automation_runs (automation_id);

alter table public.email_automation_runs enable row level security;

-- Read-only to comms staff; all writes go through the definer RPCs below
-- and the service-role worker.
create policy email_automation_runs_select on public.email_automation_runs
  for select using (public.effective_can(gym_id, 'can_manage_comms'));

-- ============================================================================
-- 3. enqueue_due_automation_runs — the polling sweep core
-- ============================================================================
--
-- For each enabled automation, insert queued runs for every subject whose
-- anchor event + delay has elapsed. Only anchor events at or after the
-- automation's created_at are eligible, so enabling an automation never
-- blasts the entire back-catalogue. Member triggers resolve email + apply
-- blanket/per-topic suppression by reusing comms_audience_rows (all_members)
-- — a suppressed member simply doesn't come back, so is never enqueued.
-- Lead triggers require marketing_consent (GDPR). on conflict do nothing
-- makes the whole sweep idempotent.

create or replace function public.enqueue_due_automation_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.email_automations%rowtype;
  v_total integer := 0;
  v_rows  integer;
  v_days  integer;
  v_hours integer;
begin
  -- compiled_html is required to send; the UI won't let an automation be
  -- enabled without a valid body, but guard here too.
  for a in select * from public.email_automations
             where enabled and compiled_html is not null loop
    if a.trigger_type = 'member_joined' then
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':member:' || s.profile_id,
             gm.created_at + make_interval(mins => a.delay_minutes)
      from public.gym_memberships gm
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = gm.profile_id
      where gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
        and gm.created_at >= a.created_at
        and gm.created_at + make_interval(mins => a.delay_minutes) <= now()
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_first_class' then
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':booking:' || b.id,
             b.attended_at + make_interval(mins => a.delay_minutes)
      from public.class_bookings b
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = b.profile_id
      where b.gym_id = a.gym_id and b.attended_at is not null
        and b.attended_at >= a.created_at
        and b.attended_at + make_interval(mins => a.delay_minutes) <= now()
        and not exists (
          select 1 from public.class_bookings b2
          where b2.gym_id = a.gym_id and b2.profile_id = b.profile_id
            and b2.attended_at is not null and b2.attended_at < b.attended_at)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_inactive' then
      v_days := coalesce((a.params->>'inactive_days')::int, 21);
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':member:' || s.profile_id || ':' || to_char(la.last_at, 'YYYY-MM-DD'),
             la.last_at + make_interval(days => v_days)
      from (
        select b.profile_id, max(b.attended_at) as last_at
        from public.class_bookings b
        where b.gym_id = a.gym_id and b.attended_at is not null
        group by b.profile_id
      ) la
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.profile_id = la.profile_id
       and gm.role = 'member' and gm.left_at is null
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = la.profile_id
      where la.last_at >= a.created_at
        and la.last_at < now() - make_interval(days => v_days)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'lead_cold' then
      v_hours := coalesce((a.params->>'cold_hours')::int, 24);
      insert into public.email_automation_runs
        (gym_id, automation_id, lead_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, l.id, l.email, l.full_name, 'queued',
             'auto:' || a.id || ':lead:' || l.id,
             l.captured_at + make_interval(hours => v_hours)
      from public.leads l
      where l.gym_id = a.gym_id and l.status = 'cold'
        and l.archived_at is null and l.converted_profile_id is null
        and l.marketing_consent = true
        and l.email is not null and length(trim(l.email)) > 0
        and l.captured_at >= a.created_at
        and l.captured_at + make_interval(hours => v_hours) <= now()
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end if;
  end loop;

  return v_total;
end;
$$;
revoke execute on function public.enqueue_due_automation_runs()
  from public, anon, authenticated;

-- ============================================================================
-- 4. dispatch_email_automations — cron entrypoint (enqueue + fire worker)
-- ============================================================================
--
-- Mirrors run_security_monitor (0111): enqueue, then best-effort net.http_post
-- to the worker. The URL + shared secret are out-of-band GUCs; a missing
-- endpoint (local/CI) never breaks the enqueue — the rows just sit queued
-- until the worker (or a retry) drains them.

create or replace function public.dispatch_email_automations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new    integer;
  v_url    text := current_setting('app.automation_worker_url', true);
  v_secret text := coalesce(current_setting('app.automation_worker_secret', true), '');
begin
  v_new := public.enqueue_due_automation_runs();

  if v_url is not null and v_url <> '' then
    begin
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-automation-secret', v_secret
        ),
        body := jsonb_build_object('enqueued', v_new)
      );
    exception when others then
      null; -- pg_net missing / endpoint down — rows stay queued, retryable.
    end;
  end if;

  return v_new;
end;
$$;
revoke execute on function public.dispatch_email_automations()
  from public, anon, authenticated;

-- ============================================================================
-- 5. Unsubscribe / consent-withdrawal (reuse the existing suppression model)
-- ============================================================================
--
-- Keyed off the unguessable run id (capability-URL model, like
-- comms_track_event). Granted to anon so the link in the email works.

create or replace function public.automation_unsubscribe(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym   uuid;
  v_email text;
  v_prof  uuid;
  v_topic uuid;
begin
  select r.gym_id, r.recipient_email, r.subject_profile_id, a.topic_id
    into v_gym, v_email, v_prof, v_topic
    from public.email_automation_runs r
    join public.email_automations a on a.id = r.automation_id
    where r.id = p_run_id;
  if v_gym is null then
    return; -- unknown run — silently no-op (don't leak existence)
  end if;

  if v_topic is null then
    insert into public.email_unsubscribes (gym_id, email, profile_id, reason)
      values (v_gym, v_email, v_prof, 'automation')
      on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  else
    insert into public.email_unsubscribes (gym_id, email, profile_id, topic_id, reason)
      values (v_gym, v_email, v_prof, v_topic, 'automation')
      on conflict (gym_id, lower(email), topic_id) where topic_id is not null do nothing;
  end if;
end;
$$;
grant execute on function public.automation_unsubscribe(uuid) to anon, authenticated;

create or replace function public.lead_withdraw_marketing_consent(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
begin
  select lead_id into v_lead from public.email_automation_runs where id = p_run_id;
  if v_lead is null then
    return;
  end if;
  update public.leads
    set marketing_consent = false, consent_at = null
    where id = v_lead;
end;
$$;
grant execute on function public.lead_withdraw_marketing_consent(uuid) to anon, authenticated;

-- ============================================================================
-- 6. send_automation_test — enqueue a one-off run to the caller (preview)
-- ============================================================================

create or replace function public.send_automation_test(p_automation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym   uuid;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.email_automations where id = p_automation_id;
  if v_gym is null then
    raise exception 'Automation not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Your account has no email address';
  end if;

  insert into public.email_automation_runs
    (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
     status, idempotency_key, scheduled_at)
  values
    (v_gym, p_automation_id, v_uid, v_email, null, 'queued',
     'auto:' || p_automation_id || ':test:' || gen_random_uuid(),
     now());
end;
$$;
grant execute on function public.send_automation_test(uuid) to authenticated;

commit;
