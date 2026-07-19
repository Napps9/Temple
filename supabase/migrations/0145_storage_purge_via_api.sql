-- Storage deletion via the Storage API, not SQL.
--
-- Both retention sweeps (0137 recordings, 0143 conversations) deleted from
-- storage.objects directly. Newer storage versions install a
-- storage.protect_delete trigger that raises "Direct deletion from storage
-- tables is not allowed" — pgTAP caught it the first time a sweep actually
-- ran under test, and the hosted nightly recordings sweep would hit the
-- same wall. There is no sanctioned SQL bypass; objects must be removed
-- through the Storage API.
--
-- New shape: the sweeps delete only DATABASE rows and queue each dead
-- recording's path in agent_storage_purge_queue, then poke the
-- purge-agent-storage edge function (pg_net + a shared secret from Vault,
-- same architecture as security-alert 0121/0126). The function deletes the
-- objects with the service key and clears the queue; failures leave queue
-- rows behind for the next nightly poke, so audio cannot silently outlive
-- its retention window.
--
-- Operator setup (mirrors SECURITY_ALERT_SECRET):
--   supabase secrets set PURGE_STORAGE_SECRET=<random>
--   select vault.create_secret('<same value>', 'agent_storage_purge_secret');

begin;

create table public.agent_storage_purge_queue (
  id         uuid primary key default gen_random_uuid(),
  bucket     text not null default 'agent-call-recordings',
  path       text not null,
  created_at timestamptz not null default now()
);
alter table public.agent_storage_purge_queue enable row level security;

create or replace function public._poke_agent_storage_purge()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'agent_storage_purge_secret'
   limit 1;
  if v_secret is null then
    return; -- not configured (e.g. local test DB) — queue simply accrues
  end if;
  begin
    perform net.http_post(
      url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/purge-agent-storage',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-purge-secret', v_secret
      ),
      body := '{}'::jsonb
    );
  exception when others then
    null; -- pg_net missing / endpoint down — queue rows wait for tomorrow
  end;
end;
$$;
revoke execute on function public._poke_agent_storage_purge()
  from public, anon, authenticated;

create or replace function public.purge_expired_agent_recordings()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with expired as (
    select r.id, r.recording_path
      from public.call_recordings r
      join public.gym_agent_settings s on s.gym_id = r.gym_id
      where r.created_at < now() - make_interval(days => s.call_recording_retention_days)
  ),
  queued as (
    insert into public.agent_storage_purge_queue (path)
      select recording_path from expired
      returning 1
  ),
  del_rec as (
    delete from public.call_recordings r using expired e where r.id = e.id
      returning 1
  )
  select count(*) into v_count from del_rec;

  if v_count > 0 then
    perform public._poke_agent_storage_purge();
  end if;
  return v_count;
end;
$$;

create or replace function public.purge_expired_agent_conversations()
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
  queued as (
    insert into public.agent_storage_purge_queue (path)
      select r.recording_path
        from public.call_recordings r
        join expired e on e.id = r.conversation_id
      returning 1
  ),
  del_conv as (
    delete from public.agent_conversations c using expired e where c.id = e.id
      returning 1
  )
  select count(*) into v_count from del_conv;

  if v_count > 0 then
    perform public._poke_agent_storage_purge();
  end if;
  return v_count;
end;
$$;

commit;
