-- The scheduled-send path had never run end to end. pgTAP proves the
-- dispatcher, the Vault credential, the snapshot and the stall recovery,
-- but pg_net is stubbed in tests, so the one leg nobody had watched is
-- the dispatcher's POST reaching send-campaign through the gateway and
-- the worker accepting the shared secret. Whether it did is written in
-- net._http_response, and that table is in a schema PostgREST does not
-- expose: the runbook's only way to read it is a person in the SQL
-- editor.
--
-- This is the definer that lets the probe (scripts/probe-scheduled-send.ts,
-- run from the Run the gym workflow with the service role) read the
-- gateway's last replies. Nobody but the service role can call it: a
-- reply body can carry a worker's error text, which is not for a gym.
--
-- plpgsql rather than sql so the table is resolved when the function is
-- called, not when it is created: the local pgTAP harness has pg_net's
-- functions stubbed and this table stubbed beside them.

create function public.recent_worker_responses(p_limit integer default 5)
returns table (
  id          bigint,
  created     timestamptz,
  status_code integer,
  content     text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select r.id, r.created, r.status_code, left(r.content, 500)
      from net._http_response r
     order by r.created desc
     limit greatest(1, least(coalesce(p_limit, 5), 50));
end;
$$;

revoke execute on function public.recent_worker_responses(integer)
  from public, anon, authenticated;
grant execute on function public.recent_worker_responses(integer)
  to service_role;
