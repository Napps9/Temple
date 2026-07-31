-- Which screens get opened, with no name attached
--
-- The Back Office (this week) gave the burndown a baseline and no
-- evidence. One screen has been retired because the Timeline demonstrably
-- does the same job; every candidate after that is a matter of opinion
-- until somebody can answer "has anyone opened this in ninety days".
-- Temple has never counted anything: no analytics SDK in the app, no
-- usage table in the schema, nothing in 232 migrations.
--
-- WHAT IS COLLECTED IS THE LEAST THAT ANSWERS THE QUESTION. A gym, a
-- route, a day, a number.
--
-- There is no profile_id column, and that is a design decision rather
-- than an omission to be corrected later. The two access logs that do
-- exist — health_data_access_log (0037) and agent_recording_access_log
-- (0137) — are per-person in both directions because they are audit
-- trails, and the entire point of an audit trail is who looked at whose
-- data. This is a measure, and the entire point of a measure is how many.
-- A table without the column cannot become a record of which staff member
-- opened which screen, whoever decides they would like one.
--
-- Route strings are normalised on the way in as well as on the device:
-- /management/members/<uuid> is stored as /management/members/[id]. That
-- is the privacy rule and also the right granularity — the question is
-- whether the member profile gets used, not which member. A client is not
-- a place to enforce a privacy rule, so the same collapse happens here
-- even though src/lib/route-usage.ts already did it.
--
-- NOT BEHIND THE CONSENT BANNER, on purpose and on the record.
-- src/lib/cookie-consent.ts says hasAnalyticsConsent() "is the gate any
-- future tracking init must check", and that wording is about
-- non-essential *storage* — a cookie, a localStorage key, something left
-- on a device. This leaves nothing on any device, identifies nobody, and
-- covers staff surfaces only. Gating it would have made the burndown a
-- measure of consent rate rather than of usage, which is the opposite of
-- what it is for. docs/legal/lawful-basis-register.md and
-- docs/legal/dpia.md carry the reasoning so it is a decision somebody
-- made rather than one nobody noticed.

begin;

create table public.route_opens (
  gym_id uuid    not null references public.gyms(id) on delete cascade,
  route  text    not null,
  day    date    not null,
  opens  integer not null default 0,
  primary key (gym_id, route, day)
);

create index route_opens_gym_day_idx on public.route_opens (gym_id, day desc);

alter table public.route_opens enable row level security;

-- Read by admins, for their own gym. No insert, update or delete policy at
-- all: the only writer is the definer function below, so a count cannot be
-- forged, inflated or quietly edited from a client.
create policy route_opens_select on public.route_opens
  for select using (public.effective_can(gym_id, 'can_manage_staff'));

-- ---------------------------------------------------------------------------
-- Recording one
-- ---------------------------------------------------------------------------

create or replace function public.record_route_open(
  p_gym_id uuid,
  p_route  text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route text;
  v_day   date;
begin
  -- Anyone who can be on a staff screen may say they were on one; nobody
  -- else may write a row for a gym at all. Silent rather than raising:
  -- this is called fire-and-forget from a navigation effect, and an
  -- exception there is a crash on a screen change for the sake of a
  -- counter.
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    return;
  end if;
  if p_route is null or length(trim(p_route)) = 0 then
    return;
  end if;

  -- The same collapse the client already did. Done again because the
  -- client is not where a privacy rule is enforced: uuids, long opaque
  -- strings and bare numbers all become [id].
  v_route := lower(left(trim(p_route), 120));
  v_route := regexp_replace(
    v_route,
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '/[id]', 'g');
  v_route := regexp_replace(v_route, '/[a-z0-9_-]{24,}', '/[id]', 'g');
  v_route := regexp_replace(v_route, '/[0-9]+', '/[id]', 'g');

  -- The gym's day, like everything else. A gym in Sydney should not have
  -- its evening filed under yesterday.
  select (now() at time zone coalesce(g.timezone, 'UTC'))::date
    into v_day
    from public.gyms g where g.id = p_gym_id;
  if v_day is null then
    return;
  end if;

  insert into public.route_opens (gym_id, route, day, opens)
  values (p_gym_id, v_route, v_day, 1)
  on conflict (gym_id, route, day)
  do update set opens = public.route_opens.opens + 1;
end;
$$;

grant execute on function public.record_route_open(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading it back
-- ---------------------------------------------------------------------------
--
-- No screen yet. The burndown is a decision somebody makes by looking,
-- not a dashboard anybody asked for, and building the dashboard first is
-- how a measure becomes a feature nobody uses.

create or replace function public.gym_route_usage(
  p_gym_id uuid,
  p_days   integer default 90
) returns table (
  route       text,
  opens       bigint,
  last_opened date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 1), 365);
begin
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;

  return query
  select r.route, sum(r.opens)::bigint, max(r.day)
    from public.route_opens r
   where r.gym_id = p_gym_id
     and r.day >= (current_date - v_days)
   group by r.route
   order by sum(r.opens) desc;
end;
$$;

revoke all on function public.gym_route_usage(uuid, integer) from public, anon;
grant execute on function public.gym_route_usage(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Forgetting it
-- ---------------------------------------------------------------------------
--
-- Ninety days, which is exactly the window the question asks about — data
-- kept past the point it can answer anything is just data being kept.
-- Named purge_expired_* so supabase/tests/sweeps_are_cron_only.sql, which
-- matches on `proname like 'purge\_%'`, covers it without being edited.

create or replace function public.purge_expired_route_opens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.route_opens
      where day < current_date - 90
      returning 1
  )
  select count(*)::int into v_count from deleted;
  return v_count;
end;
$$;

revoke execute on function public.purge_expired_route_opens()
  from public, anon, authenticated;

-- 03:40 — 03:00 health, 03:20 chat turns, 03:30 leads, 03:45 auto-tags.
select cron.schedule(
  'purge-expired-route-opens',
  '40 3 * * *',
  $$select public._log_cron_run('purge-expired-route-opens',
      to_jsonb(public.purge_expired_route_opens()));$$
);

-- ---------------------------------------------------------------------------
-- One sweep that has never been visible
-- ---------------------------------------------------------------------------
--
-- 0189 wrapped eleven sweeps in _log_cron_run at the schedule so that
-- "has this ever run" stopped taking a night to answer. 0221 added a
-- twelfth and scheduled it bare, so purge-expired-chat-turns is the one
-- sweep that deletes member data every night and leaves no trace in
-- cron_run_log — invisible in exactly the way 0189 exists to prevent.
-- cron.schedule upserts by job name, so re-registering it is the whole
-- fix and the function itself is untouched.

select cron.schedule(
  'purge-expired-chat-turns',
  '20 3 * * *',
  $$select public._log_cron_run('purge-expired-chat-turns',
      to_jsonb(public.purge_expired_chat_turns()));$$
);

commit;
