-- Abuse and retention guardrails for the AI front desk's outbound email
-- and stored conversations.
--
-- 1. agent_email_sends + agent_email_send_allowed: enroll_member /
--    start_onboarding email whatever address the caller dictates, so an
--    abuser could use the agent to bombard a third party (and mint auth
--    users for unseen addresses). Cap: 3 sends per conversation per day
--    and 3 per (gym, address) per day, atomically recorded — the executors
--    fail closed when the RPC errors.
-- 2. Transcript retention: agent conversations held volunteered personal
--    remarks forever, outside every erasure path. conversation_retention_days
--    (default 365, floor 30) + purge_expired_agent_conversations() age them
--    out; recordings' storage objects are removed first so cascading the
--    call_recordings rows cannot orphan audio in the bucket.
-- 3. daily_message_cap: bounds the agent's outbound SMS volume per gym per
--    day — a hostile or chatty texter otherwise burns unbounded model and
--    Twilio spend. Checked in lead-agent-sms; over the cap the thread is
--    handed off instead of replied to.

begin;

create table public.agent_email_sends (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  email           text not null,
  created_at      timestamptz not null default now()
);
create index agent_email_sends_conversation_idx
  on public.agent_email_sends(conversation_id, created_at desc);
create index agent_email_sends_gym_email_idx
  on public.agent_email_sends(gym_id, lower(email), created_at desc);
alter table public.agent_email_sends enable row level security;

create function public.agent_email_send_allowed(
  p_conversation_id uuid,
  p_email           text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_gym   uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select gym_id into v_gym
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null or v_email = '' then
    return false;
  end if;

  if (select count(*) from public.agent_email_sends
      where conversation_id = p_conversation_id
        and created_at > now() - interval '1 day') >= 3 then
    return false;
  end if;
  if (select count(*) from public.agent_email_sends
      where gym_id = v_gym and lower(email) = v_email
        and created_at > now() - interval '1 day') >= 3 then
    return false;
  end if;

  insert into public.agent_email_sends (gym_id, conversation_id, email)
  values (v_gym, p_conversation_id, v_email);
  return true;
end;
$$;
revoke execute on function public.agent_email_send_allowed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.agent_email_send_allowed(uuid, text)
  to service_role;

alter table public.gym_agent_settings
  add column if not exists conversation_retention_days integer not null default 365
    check (conversation_retention_days >= 30),
  add column if not exists daily_message_cap integer not null default 200
    check (daily_message_cap >= 20);

create function public.purge_expired_agent_conversations()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with expired as (
    select c.id
      from public.agent_conversations c
      join public.gym_agent_settings s on s.gym_id = c.gym_id
      where c.last_message_at < now() - make_interval(days => s.conversation_retention_days)
  ),
  del_obj as (
    delete from storage.objects o
      using public.call_recordings r, expired e
      where r.conversation_id = e.id
        and o.bucket_id = 'agent-call-recordings' and o.name = r.recording_path
      returning 1
  ),
  del_conv as (
    delete from public.agent_conversations c using expired e where c.id = e.id
      returning 1
  )
  select count(*) into v_count from del_conv;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_agent_conversations()
  from public, anon, authenticated;

create function public.set_gym_agent_limits(
  p_gym_id                      uuid,
  p_daily_message_cap           integer,
  p_conversation_retention_days integer
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk limits';
  end if;
  if p_daily_message_cap is null or p_daily_message_cap < 20 then
    raise exception 'The daily message cap must be at least 20';
  end if;
  if p_conversation_retention_days is null or p_conversation_retention_days < 30 then
    raise exception 'Conversation retention must be at least 30 days';
  end if;
  insert into public.gym_agent_settings
    (gym_id, daily_message_cap, conversation_retention_days, updated_at)
  values (p_gym_id, p_daily_message_cap, p_conversation_retention_days, now())
  on conflict (gym_id) do update
    set daily_message_cap = excluded.daily_message_cap,
        conversation_retention_days = excluded.conversation_retention_days,
        updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_limits(uuid, integer, integer)
  to authenticated;

select cron.schedule(
  'purge-expired-agent-conversations',
  '30 4 * * *', -- daily 04:30 UTC, staggered off the 04:00 recordings sweep
  $$select public.purge_expired_agent_conversations();$$
);

commit;
