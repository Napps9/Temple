-- Nothing reported a client crash. The crash screen (_layout.tsx) shows
-- the route, the message and the component stack so that a screenshot is
-- the bug report — and a screenshot is the only transport it had. The
-- first sign of a defect in production was a gym sending one.
--
-- This is the in-house transport: a table the app writes through a
-- definer RPC, read by the gym's owner on a Diagnostics page, trimmed
-- after thirty days by a logged sweep. No vendor, no secret, no cookie:
-- a crash report carries the route, the message and the stack, and the
-- caller's own id and gym when signed in, which is the minimum needed to
-- act on it (lawful-basis register, item added 2026-09-06).

create table public.client_errors (
  id              bigserial primary key,
  gym_id          uuid references public.gyms(id) on delete cascade,
  profile_id      uuid references public.profiles(id) on delete set null,
  route           text,
  message         text not null,
  stack           text,
  component_stack text,
  platform        text,
  app_version     text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index client_errors_gym_recent_idx
  on public.client_errors(gym_id, created_at desc);
create index client_errors_profile_recent_idx
  on public.client_errors(profile_id, created_at desc);

alter table public.client_errors enable row level security;

-- The gym's owner reads their gym's rows. Nobody writes directly: the
-- RPC below is the only door, and the grant beneath a policy that does
-- not exist is revoked so it cannot be leaned on by accident.
create policy client_errors_owner_read on public.client_errors
  for select using (
    gym_id is not null and public.effective_can(gym_id, 'can_manage_staff')
  );

revoke insert, update, delete on public.client_errors from anon, authenticated;

-- Callable signed in or not: a crash on the sign-in screen is still a
-- crash. Signed-in reports carry the caller and their gym; a caller is
-- capped at twenty an hour and anonymous reports at a hundred, so a
-- render loop cannot fill the table before the sweep.
create or replace function public.report_client_error(
  p_route           text,
  p_message         text,
  p_stack           text,
  p_component_stack text,
  p_platform        text,
  p_app_version     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_gym    uuid;
  v_recent integer;
  v_agent  text;
begin
  if p_message is null or length(btrim(p_message)) = 0 then
    return;
  end if;

  if v_uid is not null then
    select count(*) into v_recent from public.client_errors
      where profile_id = v_uid and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
      return;
    end if;
    -- The same membership the app lands the caller in: the oldest one
    -- they have not left.
    select gym_id into v_gym from public.gym_memberships
      where profile_id = v_uid and left_at is null
      order by created_at
      limit 1;
  else
    select count(*) into v_recent from public.client_errors
      where profile_id is null and created_at > now() - interval '1 hour';
    if v_recent >= 100 then
      return;
    end if;
  end if;

  v_agent := nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent';

  insert into public.client_errors
    (gym_id, profile_id, route, message, stack, component_stack,
     platform, app_version, user_agent)
  values
    (v_gym, v_uid,
     left(p_route, 200),
     left(p_message, 1000),
     left(p_stack, 4000),
     left(p_component_stack, 4000),
     left(p_platform, 40),
     left(p_app_version, 40),
     left(v_agent, 300));
end;
$$;

grant execute on function public.report_client_error(text, text, text, text, text, text)
  to anon, authenticated;

-- Thirty days is long enough to act on and short enough that the table
-- is never the record of anybody. Logged like every other sweep.
create or replace function public.purge_old_client_errors()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.client_errors
      where created_at < now() - interval '30 days'
      returning id
  )
  select count(*) into v_count from deleted;
  perform public._log_cron_run('purge-old-client-errors',
    jsonb_build_object('deleted', v_count));
  return v_count;
end;
$$;

revoke execute on function public.purge_old_client_errors()
  from public, anon, authenticated;

-- 03:25 UTC, beside the other purges.
select cron.schedule(
  'purge-old-client-errors',
  '25 3 * * *',
  $$select public.purge_old_client_errors();$$
);
