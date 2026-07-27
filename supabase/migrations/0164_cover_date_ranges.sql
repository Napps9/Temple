-- Cover requests by date range.
--
-- request_cover (0014) only takes an explicit uuid[] of class sessions.
-- That works for "I can't make Tuesday 6am" and falls apart for the case
-- that actually drives cover in a gym — a coach going away. "Cover me
-- from 22 Dec to 3 Jan" meant ticking a dozen boxes, and only worked at
-- all if those classes had already been materialised. They usually
-- haven't: extend_recurrence (0005/0035) is called lazily from the
-- client and only reaches gyms.materialisation_horizon_weeks (12 by
-- default, 0049), so a Christmas request lodged in July silently
-- resolved to nothing.
--
-- A range request here is a STANDING WINDOW, not a bulk-select
-- shortcut. The requested dates live on the request; classes inside the
-- window are offered immediately, and classes created into the window
-- later are attached automatically by a trigger. That is what makes
-- "22 Dec to 3 Jan" mean the same thing in July as it does in December.
--
-- Sections:
--   1. requested_start / requested_end on cover_requests
--   2. extend_gym_recurrences  — materialise out to the range end
--   3. request_cover_range     — the new RPC
--   4. auto-attach trigger     — the standing half of the window
--   5. status rollup trigger   — headers stop going stale (see 0018)
--   6. cancel_cover_request    — a 'partial' request becomes cancellable
--   7. expire_cover_requests   — the 'expired' status stops being dead
--
-- No capability changes: can_request_cover / can_claim_cover already
-- exist in default_capability (current body in 0137), so it is not
-- re-declared here.

begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================
--
-- Both columns null = a classic per-session request. Both set = a
-- standing range. range_start / range_end stay NOT NULL and, for a range
-- request, hold the resolved timestamptz window — which satisfies the
-- table's existing `check (range_end > range_start)` even when the
-- window matches zero classes.
--
-- The literal dates are stored alongside the resolved window so display
-- never drifts with the viewer's timezone, and so the window can be
-- recomputed from gyms.timezone at match time if a gym later corrects
-- its timezone.

alter table public.cover_requests
  add column requested_start date,
  add column requested_end   date;

alter table public.cover_requests
  add constraint cover_requests_requested_window_ck
  check (
    (requested_start is null) = (requested_end is null)
    and (requested_end is null or requested_end >= requested_start)
  );

-- The auto-attach trigger's lookup path: live standing windows for one
-- coach at one gym. Partial so bulk materialisation stays cheap.
create index cover_requests_standing_window_idx
  on public.cover_requests(gym_id, requested_by)
  where requested_start is not null and status not in ('cancelled', 'expired');

-- ============================================================================
-- 2. extend_gym_recurrences
-- ============================================================================
--
-- The same work ClassesCalendar does on mount (one extend_recurrence
-- round-trip per recurrence), done server-side in one call so the cover
-- range flow can reach past the materialisation horizon. extend_recurrence
-- already no-ops on archived class types (0035) and honours ends_on, so
-- there is nothing extra to filter here.

create or replace function public.extend_gym_recurrences(
  p_gym_id uuid,
  p_until  date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until date;
  v_rec   uuid;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  -- A mistyped year should not materialise a decade of classes.
  v_until := least(p_until, (current_date + interval '52 weeks')::date);
  if v_until is null or v_until <= current_date then
    return;
  end if;

  for v_rec in
    select id from public.class_recurrences where gym_id = p_gym_id
  loop
    perform public.extend_recurrence(v_rec, v_until);
  end loop;
end;
$$;

grant execute on function public.extend_gym_recurrences(uuid, date) to authenticated;

-- ============================================================================
-- 3. request_cover_range
-- ============================================================================
--
-- p_gym_id is explicit rather than derived from the sessions (as
-- request_cover does) because a range can legitimately match nothing —
-- there is no session to read the gym off, and a coach may belong to
-- several gyms.
--
-- p_exclude_session_ids is what lets ranges and individual classes
-- compose: pick the window, untick the one class you'll still teach.
-- Exclusions only apply to classes that exist at request time, which is
-- exactly right — a class created later can't have been unticked.

create or replace function public.request_cover_range(
  p_gym_id              uuid,
  p_start               date,
  p_end                 date,
  p_exclude_session_ids uuid[],
  p_notes               text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_tz           text;
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_request_id   uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_start is null or p_end is null then
    raise exception 'Pick a start and end date';
  end if;
  if p_end < p_start then
    raise exception 'End date is before the start date';
  end if;
  if not public.user_can_cover(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  select timezone into v_tz from public.gyms where id = p_gym_id;
  if v_tz is null then
    raise exception 'Gym not found';
  end if;

  -- End-exclusive start of the following day, so "to 3rd January"
  -- includes every class on the 3rd whatever time it runs.
  v_window_start := (p_start::text || ' 00:00')::timestamp at time zone v_tz;
  v_window_end   := ((p_end + 1)::text || ' 00:00')::timestamp at time zone v_tz;
  if v_window_end <= now() then
    raise exception 'That date range is in the past';
  end if;

  -- Materialise before resolving, so a window past the horizon finds
  -- real classes. Runs before the header exists on purpose: the
  -- auto-attach trigger fires on these inserts and can only see OLDER
  -- standing windows, and the `not exists` guard below then skips
  -- anything it claimed.
  perform public.extend_gym_recurrences(p_gym_id, p_end);

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, notes,
     requested_start, requested_end)
  values
    (p_gym_id, v_uid, v_window_start, v_window_end, p_notes,
     p_start, p_end)
  returning id into v_request_id;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  select v_request_id, cs.id, v_uid, p_gym_id
  from public.class_sessions cs
  where cs.gym_id    = p_gym_id
    and cs.coach_id  = v_uid
    and cs.starts_at >= greatest(v_window_start, now())
    and cs.starts_at <  v_window_end
    and not (cs.id = any(coalesce(p_exclude_session_ids, '{}'::uuid[])))
    and not exists (
      select 1 from public.cover_request_sessions x
      where x.class_session_id = cs.id and x.claimed_by is null
    );

  -- A window matching nothing is not an error: the standing half means
  -- classes scheduled into it later still get offered.
  return v_request_id;
end;
$$;

grant execute on function public.request_cover_range(uuid, date, date, uuid[], text)
  to authenticated;

-- ============================================================================
-- 4. Auto-attach trigger
-- ============================================================================
--
-- INSERT only, deliberately. The only code path in the app that writes
-- class_sessions.coach_id after creation is claim_cover. Firing on
-- UPDATE OF coach_id would mean a coach who claims a class inside their
-- own open away-window immediately re-offers it. Insert covers the two
-- real sources of new classes: recurrence materialisation and one-off
-- creation.

create or replace function public._attach_session_to_standing_cover()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_inserted   integer;
begin
  if new.coach_id is null or new.starts_at <= now() then
    return null;
  end if;

  -- Oldest live window wins, so overlapping windows can't double-offer
  -- the same class.
  select cr.id into v_request_id
  from public.cover_requests cr
  join public.gyms g on g.id = cr.gym_id
  where cr.gym_id            = new.gym_id
    and cr.requested_by      = new.coach_id
    and cr.requested_start is not null
    and cr.status not in ('cancelled', 'expired')
    and new.starts_at >= (cr.requested_start::text || ' 00:00')::timestamp
                           at time zone g.timezone
    and new.starts_at <  ((cr.requested_end + 1)::text || ' 00:00')::timestamp
                           at time zone g.timezone
  order by cr.created_at
  limit 1;

  if v_request_id is null then
    return null;
  end if;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request_id, new.id, new.coach_id, new.gym_id)
  on conflict (class_session_id) where claimed_by is null do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return null;
  end if;

  -- A window that had rolled to 'claimed' is open again once it gains a
  -- fresh unclaimed class.
  update public.cover_requests
    set status = case
      when exists (
        select 1 from public.cover_request_sessions
        where request_id = v_request_id and claimed_by is not null
      ) then 'partial'
      else 'open'
    end
    where id = v_request_id
      and status in ('open', 'partial', 'claimed');

  return null;
end;
$$;

drop trigger if exists class_sessions_attach_standing_cover on public.class_sessions;
create trigger class_sessions_attach_standing_cover
  after insert on public.class_sessions
  for each row execute function public._attach_session_to_standing_cover();

-- ============================================================================
-- 5. Status rollup when offers disappear
-- ============================================================================
--
-- cancel_session (0018) deletes the class and lets ON DELETE CASCADE
-- take the cover_request_sessions rows with it, but nothing ever
-- updated the parent header — it sat at 'open' with zero children
-- forever. Recompute from the surviving children instead.
--
-- The "no children left" branch keeps a still-future standing window
-- 'open': an empty window is a legitimate state for a range request,
-- and closing it would break the standing promise.

create or replace function public._rollup_cover_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.cover_requests;
  v_total   integer;
  v_open    integer;
  v_live    boolean;
begin
  select * into v_request
    from public.cover_requests where id = old.request_id;
  -- Parent already gone (gym cascade), or deliberately cancelled.
  if v_request is null or v_request.status = 'cancelled' then
    return null;
  end if;

  select count(*), count(*) filter (where claimed_by is null)
    into v_total, v_open
    from public.cover_request_sessions
    where request_id = old.request_id;

  if v_total > 0 then
    update public.cover_requests
      set status = case
        when v_open = 0 then 'claimed'
        when v_open < v_total then 'partial'
        else 'open'
      end
      where id = old.request_id;
    return null;
  end if;

  select v_request.requested_start is not null
     and v_request.requested_end >= (now() at time zone g.timezone)::date
    into v_live
    from public.gyms g where g.id = v_request.gym_id;

  update public.cover_requests
    set status = case when coalesce(v_live, false) then 'open' else 'expired' end
    where id = old.request_id;

  return null;
end;
$$;

drop trigger if exists cover_request_sessions_rollup on public.cover_request_sessions;
create trigger cover_request_sessions_rollup
  after delete on public.cover_request_sessions
  for each row execute function public._rollup_cover_request_status();

-- ============================================================================
-- 6. cancel_cover_request — a 'partial' request is withdrawable
-- ============================================================================
--
-- 0014 refused unless status = 'open' and no sibling had been claimed,
-- which meant one claim froze the whole request. Tolerable for two
-- classes; unacceptable for a two-week range. Withdraw the unclaimed
-- offers and leave the claimed ones (and their coach swaps) alone.
--
-- Signature unchanged, so CREATE OR REPLACE is safe here.

create or replace function public.cancel_cover_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_request public.cover_requests;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_request from public.cover_requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Cover request not found';
  end if;
  if v_request.requested_by <> v_uid and not public.user_can_admin(v_request.gym_id) then
    raise exception 'Not authorised';
  end if;
  if v_request.status not in ('open', 'partial') then
    raise exception 'Cover request cannot be cancelled in state %', v_request.status;
  end if;

  delete from public.cover_request_sessions
    where request_id = p_request_id and claimed_by is null;

  -- Lands after the rollup trigger, which is the intended order.
  update public.cover_requests
    set status = 'cancelled', cancelled_at = now()
    where id = p_request_id;
end;
$$;

grant execute on function public.cancel_cover_request(uuid) to authenticated;

-- ============================================================================
-- 7. expire_cover_requests
-- ============================================================================
--
-- 'expired' has been in the status CHECK since 0013 and nothing ever
-- wrote it, so requests for classes that already happened sat in the
-- feed indefinitely. Same pg_cron pattern as 0095 / 0109 / 0115.

create or replace function public.expire_cover_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Dead offers first, so the feed and the open-session unique index
  -- don't carry classes that have already started.
  delete from public.cover_request_sessions crs
  using public.class_sessions cs
  where cs.id = crs.class_session_id
    and crs.claimed_by is null
    and cs.starts_at <= now();

  update public.cover_requests cr
    set status = 'expired'
    from public.gyms g
    where g.id = cr.gym_id
      and cr.status in ('open', 'partial')
      and case
        when cr.requested_end is not null
          then cr.requested_end < (now() at time zone g.timezone)::date
        else not exists (
          select 1
          from public.cover_request_sessions crs
          join public.class_sessions cs on cs.id = crs.class_session_id
          where crs.request_id = cr.id and cs.starts_at > now()
        )
      end;
end;
$$;

revoke execute on function public.expire_cover_requests()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- cron.schedule upserts by job name, so re-running this is idempotent.
select cron.schedule(
  'expire-cover-requests',
  '0 4 * * *', -- daily, off-peak; the per-gym comparison is timezone-aware
  $$select public.expire_cover_requests();$$
);

-- ============================================================================
-- 8. request_cover — min(uuid) does not exist
-- ============================================================================
--
-- 0014 derived the gym with `min(gym_id)`. There is no min() aggregate
-- for uuid before Postgres 18, so every call to request_cover raised
-- "function min(uuid) does not exist" — the per-class cover path has
-- never worked. It went unnoticed because request_cover had no pgTAP
-- coverage; the new cover_request_header_rollup.sql exercises it and
-- caught this.
--
-- array_agg + count(distinct) also make good on the "all in the same
-- gym" claim in 0014's comment, which min() never actually enforced.
--
-- Signature unchanged, so CREATE OR REPLACE is safe.

create or replace function public.request_cover(
  p_session_ids uuid[],
  p_notes       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid;
  v_gym_id        uuid;
  v_gym_count     integer;
  v_request_id    uuid;
  v_range_start   timestamptz;
  v_range_end     timestamptz;
  v_session_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'No sessions selected';
  end if;

  with sess as (
    select cs.id, cs.gym_id, cs.coach_id, cs.starts_at, cs.duration_minutes
    from public.class_sessions cs
    where cs.id = any(p_session_ids)
  )
  select
    (array_agg(distinct gym_id))[1],
    count(distinct gym_id),
    min(starts_at),
    max(starts_at + (duration_minutes || ' minutes')::interval),
    count(*) filter (where coach_id = v_uid)
  into v_gym_id, v_gym_count, v_range_start, v_range_end, v_session_count
  from sess;

  if v_session_count is null or v_session_count <> cardinality(p_session_ids) then
    raise exception 'Can only request cover for classes you coach';
  end if;
  if v_gym_count <> 1 then
    raise exception 'All classes must belong to the same gym';
  end if;
  if not public.user_can_cover(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end, notes)
  values
    (v_gym_id, v_uid, v_range_start, v_range_end, p_notes)
  returning id into v_request_id;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  select v_request_id, sid, v_uid, v_gym_id
  from unnest(p_session_ids) as sid;

  return v_request_id;
end;
$$;

grant execute on function public.request_cover(uuid[], text) to authenticated;

commit;
