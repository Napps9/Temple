-- Email automations — multi-step sequences + send-time controls (features 2+3).
--
-- Two additions, one migration because the enqueue sweep changes once for both:
--
--  * Sequences: an automation was one email; now it can be a series — a
--    welcome on day 0, tips on day 3, a nudge on day 7. The automation row
--    stays the PRIMARY email (unchanged); follow-ups live in a new
--    email_automation_steps table, each with its own delay from the trigger
--    anchor and its own body. (Additive on purpose: existing automations
--    simply have zero follow-ups, and the primary send path is byte-for-byte
--    what 0116/0118 did.)
--
--  * Send-time: "N days after, but at 9am on a weekday" instead of firing at
--    whatever minute the delay elapses. Each email (primary or step) carries
--    an optional send_hour (0-23, gym-local) and send_days (ISO weekdays
--    1=Mon..7=Sun). _automation_send_slot rolls the due moment forward to the
--    next matching slot in the gym's timezone; null send_hour keeps today's
--    "send as soon as due" behaviour, so nothing existing shifts.
--
-- email_automation_runs gains step_id: null = the automation's primary email
-- (content read from email_automations, as before); set = a follow-up step
-- (content read from the step). Existing primary idempotency keys are kept
-- verbatim — only follow-up steps get a `:step:<id>` key segment — so the
-- sweep never re-sends a primary email that already went out.

begin;

-- ---------------------------------------------------------------------------
-- 1. Send-time on the primary email
-- ---------------------------------------------------------------------------
alter table public.email_automations
  add column send_hour integer
    check (send_hour is null or (send_hour between 0 and 23)),
  add column send_days integer[]
    check (send_days is null or send_days <@ array[1,2,3,4,5,6,7]);

-- ---------------------------------------------------------------------------
-- 2. Follow-up steps
-- ---------------------------------------------------------------------------
-- delay_minutes is measured from the trigger's anchor event (join time, first
-- class, inactivity threshold, cold-lead threshold), NOT from the previous
-- step — so day 0/3/7 = 0 / 4320 / 10080. Each step is scheduled independently
-- off the anchor; a later step doesn't wait on an earlier one succeeding.
create table public.email_automation_steps (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  step_index    integer not null default 0,
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  send_hour     integer check (send_hour is null or (send_hour between 0 and 23)),
  send_days     integer[] check (send_days is null or send_days <@ array[1,2,3,4,5,6,7]),
  subject       text not null default '',
  preheader     text not null default '',
  from_name     text,
  design        jsonb not null default '{"version":1,"blocks":[],"settings":{}}'::jsonb,
  compiled_html text check (compiled_html is null or octet_length(compiled_html) <= 2 * 1024 * 1024),
  compiled_text text check (compiled_text is null or octet_length(compiled_text) <= 512 * 1024),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index email_automation_steps_automation_idx
  on public.email_automation_steps (automation_id, step_index);

alter table public.email_automation_steps enable row level security;

create policy email_automation_steps_select on public.email_automation_steps
  for select using (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_automation_steps_insert on public.email_automation_steps
  for insert with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_automation_steps_update on public.email_automation_steps
  for update using (public.effective_can(gym_id, 'can_manage_comms'))
  with check (public.effective_can(gym_id, 'can_manage_comms'));
create policy email_automation_steps_delete on public.email_automation_steps
  for delete using (public.effective_can(gym_id, 'can_manage_comms'));

-- Keep updated_at fresh and stop a step being attached to another gym's
-- automation (edits are direct RLS table writes, like the automation itself).
create or replace function public._email_automation_steps_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.email_automations a
    where a.id = new.automation_id and a.gym_id = new.gym_id
  ) then
    raise exception 'Step does not belong to this gym''s automation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_automation_steps_touch_trg
  before insert or update on public.email_automation_steps
  for each row execute function public._email_automation_steps_touch();

-- ---------------------------------------------------------------------------
-- 3. Which email a run belongs to
-- ---------------------------------------------------------------------------
alter table public.email_automation_runs
  add column step_id uuid references public.email_automation_steps(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Send-slot helper
-- ---------------------------------------------------------------------------
-- Roll p_base forward to the next instant at p_send_hour:00 gym-local on an
-- allowed weekday. Null send_hour → p_base unchanged (send as soon as due).
-- Empty/null send_days → any weekday. Bad timezone falls back to UTC.
create or replace function public._automation_send_slot(
  p_base timestamptz, p_send_hour integer, p_send_days integer[], p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz    text := coalesce(nullif(p_tz, ''), 'UTC');
  v_local timestamp;
  v_cand  timestamp;
  i       integer := 0;
begin
  if p_send_hour is null then
    return p_base;
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  v_local := p_base at time zone v_tz;
  v_cand := date_trunc('day', v_local) + make_interval(hours => p_send_hour);
  if v_cand < v_local then
    v_cand := v_cand + interval '1 day';
  end if;
  if p_send_days is not null and array_length(p_send_days, 1) > 0 then
    while i < 7 and not (extract(isodow from v_cand)::int = any(p_send_days)) loop
      v_cand := v_cand + interval '1 day';
      i := i + 1;
    end loop;
  end if;
  return v_cand at time zone v_tz;
end;
$$;
revoke execute on function public._automation_send_slot(timestamptz, integer, integer[], text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Enqueue sweep — primary email + follow-up steps, send-time aware
-- ---------------------------------------------------------------------------
-- The set of emails an automation sends: the primary (step_id null, content
-- from the automation row) plus each follow-up step that has a body. Returns
-- the timing knobs the sweep needs (dmin/sh/sd) — content is read later, from
-- the run's step_id, by the worker.
create or replace function public._automation_emails(a public.email_automations)
returns table (step_id uuid, dmin integer, sh integer, sd integer[])
language sql
stable
set search_path = public
as $$
  select null::uuid, a.delay_minutes, a.send_hour, a.send_days
  where a.compiled_html is not null
  union all
  select st.id, st.delay_minutes, st.send_hour, st.send_days
  from public.email_automation_steps st
  where st.automation_id = a.id and st.compiled_html is not null;
$$;
revoke execute on function public._automation_emails(public.email_automations)
  from public, anon, authenticated;

-- Each trigger branch computes a per-subject anchor, then CROSS JOIN LATERALs
-- a set of "emails to send" = the primary (from the automation row, step_id
-- null) plus every follow-up step with a body. The due gate and scheduled_at
-- both run through _automation_send_slot. The primary's idempotency key is
-- exactly what 0116/0118 produced (no `:step:` segment), so already-sent
-- primaries are never re-enqueued.
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
  v_types boolean;
  v_tz    text;
begin
  for a in select * from public.email_automations where enabled loop
    select coalesce(nullif(timezone, ''), 'UTC') into v_tz
      from public.gyms where id = a.gym_id;

    if a.trigger_type = 'member_joined' then
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':member:' || s.profile_id,
             public._automation_send_slot(gm.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.gym_memberships gm
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = gm.profile_id
      cross join lateral public._automation_emails(a) stp
      where gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
        and gm.created_at >= a.created_at
        and public._automation_send_slot(gm.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_first_class' then
      v_types := jsonb_array_length(coalesce(a.conditions->'class_type_ids', '[]'::jsonb)) > 0;
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':booking:' || b.id,
             public._automation_send_slot(b.attended_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.class_bookings b
      join public.class_sessions cs on cs.id = b.class_session_id
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = b.profile_id
      cross join lateral public._automation_emails(a) stp
      where b.gym_id = a.gym_id and b.attended_at is not null
        and b.attended_at >= a.created_at
        and public._automation_send_slot(b.attended_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
        and (not v_types or cs.class_type_id::text in (
              select jsonb_array_elements_text(a.conditions->'class_type_ids')))
        and not exists (
          select 1 from public.class_bookings b2
          join public.class_sessions cs2 on cs2.id = b2.class_session_id
          where b2.gym_id = a.gym_id and b2.profile_id = b.profile_id
            and b2.attended_at is not null and b2.attended_at < b.attended_at
            and (not v_types or cs2.class_type_id::text in (
                  select jsonb_array_elements_text(a.conditions->'class_type_ids'))))
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_inactive' then
      v_days := coalesce((a.params->>'inactive_days')::int, 21);
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':member:' || s.profile_id || ':' || to_char(la.last_at, 'YYYY-MM-DD'),
             public._automation_send_slot(la.last_at + make_interval(days => v_days) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
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
      cross join lateral public._automation_emails(a) stp
      where la.last_at >= a.created_at
        and public._automation_send_slot(la.last_at + make_interval(days => v_days) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'lead_cold' then
      v_hours := coalesce((a.params->>'cold_hours')::int, 24);
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, lead_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, l.id, l.email, l.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':lead:' || l.id,
             public._automation_send_slot(l.captured_at + make_interval(hours => v_hours) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.leads l
      cross join lateral public._automation_emails(a) stp
      where l.gym_id = a.gym_id and l.status = 'cold'
        and l.archived_at is null and l.converted_profile_id is null
        and l.marketing_consent = true
        and l.email is not null and length(trim(l.email)) > 0
        and l.captured_at >= a.created_at
        and public._automation_send_slot(l.captured_at + make_interval(hours => v_hours) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and (jsonb_array_length(coalesce(a.conditions->'lead_source_ids', '[]'::jsonb)) = 0
             or l.source_id::text in (
                  select jsonb_array_elements_text(a.conditions->'lead_source_ids')))
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

commit;
