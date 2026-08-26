-- One way to reach a member
--
-- This product has five notification queues. They are five copies of one
-- idea — a row per recipient per channel, a frozen body, an idempotency
-- key, a worker that drains it — written five times because each arrived
-- with its own feature. Two of them (0165, 0169) even share the phrasing
-- of their comments. A sixth copy would be the wrong answer to the first
-- thing that wants to text somebody, so this is the general one: any
-- sender, any channel, one worker.
--
-- OUTBOUND ONLY, AND THAT IS THE WHOLE DIFFERENCE. The five queues carry
-- an 'in_app' channel because for them the row IS the notification. A
-- personal best already has its in-app surface — member_milestones (0263),
-- with its own card, its own read_at and its own place in the bell — and
-- adding a second in-app row would put the same card on the screen twice.
-- So this table holds what leaves the building: email and SMS. Naming it
-- after agent_outbound_messages rather than after the notification queues
-- is deliberate; it does the same job for members that one does for jobs.
--
-- THE ROW DOES NOT CARRY THE ADDRESS. 0175 established this and it matters
-- more here: staff capabilities for reading an email (can_see_email) and a
-- phone (can_see_full_pii) are separate from any capability that might one
-- day read these rows, so the worker resolves both itself under the
-- service role. A queue row that carried the phone number would be a
-- quieter version of the leak 0266 just closed.
--
-- CONSENT IS CHECKED AT ENQUEUE, NOT AT SEND. A member who opts out
-- between the enqueue and the drain has changed their mind about future
-- messages, not about the one already written for them — and the alternative,
-- re-checking at send, means the worker needs to understand consent as well
-- as delivery. The window is minutes.

begin;

-- ============================================================================
-- 1. The queue
-- ============================================================================

create table public.member_outbound_messages (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('personal_best')),
  channel         text not null check (channel in ('email', 'sms')),
  subject         text,
  body            text not null,
  status          text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  error           text,
  attempts        integer not null default 0,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index member_outbound_messages_queued_idx
  on public.member_outbound_messages(gym_id, status)
  where status = 'queued';

create index member_outbound_messages_sms_recent_idx
  on public.member_outbound_messages(gym_id, sent_at)
  where channel = 'sms' and status = 'sent';

alter table public.member_outbound_messages enable row level security;

-- The member's own, and nobody else's. Same rule 0263 set for milestones:
-- staff reading what the gym said to one member about their training is a
-- good surface and a different ask, with its own capability. Whether the
-- queue is draining is answered by cron_run_log, like every other worker.
create policy member_outbound_messages_self_select
  on public.member_outbound_messages
  for select using (profile_id = auth.uid());

-- ============================================================================
-- 2. Enqueuing
-- ============================================================================

create or replace function public._enqueue_member_message(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_kind       text,
  p_subject    text,
  p_body       text,
  p_key        text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_sms_ok boolean;
  v_count  integer;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;

  -- Everything has to line up: the member asked, we hold a number we can
  -- dial, and the gym's own number can carry a text. Any one missing and
  -- there is no SMS row at all — a skipped row per member per message
  -- would be a table full of the default state.
  select gm.sms_opt_in
     and c.phone_e164 is not null
     and coalesce(s.sms_capable, false)
     and coalesce(s.enabled, false)
    into v_sms_ok
    from public.gym_memberships gm
    left join public.member_contact_details c on c.profile_id = gm.profile_id
    left join public.gym_agent_settings s on s.gym_id = gm.gym_id
   where gm.gym_id = p_gym_id
     and gm.profile_id = p_profile_id
     and gm.left_at is null;

  insert into public.member_outbound_messages
    (gym_id, profile_id, kind, channel, subject, body, status, error,
     idempotency_key)
  select
    p_gym_id, p_profile_id, p_kind, c.channel,
    case when c.channel = 'email' then p_subject end,
    p_body,
    case when c.channel = 'email' and v_email is null then 'skipped'
         else 'queued' end,
    case when c.channel = 'email' and v_email is null
         then 'Member has no email address' end,
    c.channel || ':' || p_key
  from (
    select 'email' as channel
    union all
    select 'sms' where coalesce(v_sms_ok, false)
  ) c
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public._enqueue_member_message(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

-- ============================================================================
-- 3. Dispatch
-- ============================================================================
--
-- Stamped from dispatch_agent_messages (0206): one post per gym with
-- something queued, best-effort, and a cron_run_log line either way so a
-- silent worker is distinguishable from an empty queue.

create or replace function public.dispatch_member_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym     record;
  v_gyms    integer := 0;
  v_posted  integer := 0;
  v_queued  integer;
  v_started timestamptz := clock_timestamp();
  v_key     text := public._worker_service_key();
begin
  select count(*)::int into v_queued
    from public.member_outbound_messages where status = 'queued';

  if v_key is null then
    perform public._log_cron_run('dispatch-member-messages',
      jsonb_build_object('skipped', 'no worker_service_key in vault',
                         'queued', v_queued),
      (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);
    return 0;
  end if;

  for v_gym in
    select distinct gym_id from public.member_outbound_messages
     where status = 'queued'
  loop
    v_gyms := v_gyms + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-member-messages',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('gym_id', v_gym.gym_id)
      );
      v_posted := v_posted + 1;
    exception when others then
      null;
    end;
  end loop;

  perform public._log_cron_run('dispatch-member-messages',
    jsonb_build_object('gyms', v_gyms, 'posted', v_posted, 'queued', v_queued),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_posted;
end;
$$;

revoke execute on function public.dispatch_member_messages()
  from public, anon, authenticated;

select cron.schedule(
  'dispatch-member-messages',
  '*/15 * * * *',
  $$select public.dispatch_member_messages();$$
);

-- ============================================================================
-- 4. STOP has to mean something
-- ============================================================================
--
-- agent_stop_conversation closes a lead's thread and clears the lead's
-- marketing consent. A member texting STOP to the gym's number hits that
-- same handler, matches no lead, and suppresses nothing member-side — they
-- would keep being texted by a product that had just been told to stop.
-- Twilio's Advanced Opt-Out blocks delivery at the carrier, which makes
-- this worse rather than better: we would go on queueing messages that
-- silently never arrive, and go on believing the member wanted them.

create or replace function public.member_stop_texts(
  p_gym_id uuid,
  p_phone  text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164  text := public._normalise_uk_phone(p_phone);
  v_count integer;
begin
  if v_e164 is null then
    return 0;
  end if;

  update public.gym_memberships gm
     set sms_opt_in = false
    from public.member_contact_details c
   where c.profile_id = gm.profile_id
     and c.phone_e164 = v_e164
     and gm.gym_id = p_gym_id
     and gm.left_at is null
     and gm.sms_opt_in;

  get diagnostics v_count = row_count;

  -- Anything already written for them goes with it. A queued text is a
  -- message the member has now refused, and sending it because it was
  -- written first is the definition of not listening.
  update public.member_outbound_messages m
     set status = 'skipped', error = 'Member texted STOP'
    from public.member_contact_details c
   where c.profile_id = m.profile_id
     and c.phone_e164 = v_e164
     and m.gym_id = p_gym_id
     and m.channel = 'sms'
     and m.status = 'queued';

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.member_stop_texts(uuid, text) from public, anon, authenticated;

commit;
