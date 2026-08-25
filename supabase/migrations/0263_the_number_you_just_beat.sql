-- The number you just beat
--
-- A member adds 2.5kg to a back squat they have been stuck on since
-- March, and the gym says nothing. The record is real — prRowIds in
-- src/lib/movement-journal.ts finds it — but it is derived at render
-- time into a Set<string> that lives for one paint. Nothing is written
-- down, so nothing can be sent, and the moment the app most has
-- something worth saying is the moment it is silent.
--
-- So a personal best becomes a row. member_milestones follows the shape
-- payment_notifications (0175) and class_change_notifications (0169)
-- already use for "deliver one thing to one member": the body is frozen
-- at write time, read state is a timestamp, and the count joins the
-- bell through inbox_unread_summary.
--
-- Two decisions worth stating.
--
-- The direction of "better" travels as a PARAMETER, not as a table.
-- The scheme catalog lives in TypeScript (src/lib/movements.ts) and
-- says so in its own header; strength_leaderboard (0101) already takes
-- p_metric and p_better from the client for exactly this reason, and
-- validates them against the same two lists. Duplicating the catalog in
-- SQL would create a second copy to keep in step, and the copy that
-- drifts is always the one nobody is looking at.
--
-- And a first-ever log is NOT a personal best. prRowIds counts it,
-- because for a badge that is right — the first entry is the best one
-- so far. For a message it is wrong: "new best" about a number nobody
-- has ever lifted before reads as a machine talking. The claim needs a
-- prior best to beat, and it has to beat it strictly.
--
-- Idempotency is (profile, track key, local day). Somebody who logs,
-- deletes and re-logs the same session gets one card, not three; and
-- the day is the client's, because "today" is where the member is, not
-- where the database is.

begin;

create table public.member_milestones (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  kind              text not null check (kind in ('personal_best')),
  movement_key      text not null,
  track_key         text not null,
  value_numeric     numeric,
  value_seconds     integer,
  previous_numeric  numeric,
  previous_seconds  integer,
  value_unit        text,
  -- Frozen at write time, like every other notice in this schema: the
  -- member should read what the gym said then, not a sentence
  -- re-rendered from today's units.
  body              text not null,
  performed_at      timestamptz not null,
  idempotency_key   text not null unique,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index member_milestones_member_idx
  on public.member_milestones (profile_id, created_at desc);
create index member_milestones_unread_idx
  on public.member_milestones (profile_id) where read_at is null;

alter table public.member_milestones enable row level security;

-- A milestone is the member's own. Staff have no read here: a coach
-- seeing PBs is a good surface and a different ask, with its own
-- capability, not a side effect of this one.
create policy member_milestones_self_select on public.member_milestones
  for select using (profile_id = auth.uid());

create policy member_milestones_self_read on public.member_milestones
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Only read_at may be written from the client, and only through the RPC
-- below; the row itself is written by record_personal_best.
revoke insert, delete on public.member_milestones from anon, authenticated;
revoke update on public.member_milestones from anon, authenticated;

create function public.record_personal_best(
  p_gym_id       uuid,
  p_movement_key text,
  p_track_key    text,
  p_metric       text,
  p_better       text,
  p_value_numeric numeric default null,
  p_value_seconds integer default null,
  p_value_unit    text default null,
  p_performed_at  timestamptz default now(),
  p_local_day     date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_value    numeric;
  v_prior    numeric;
  v_beats    boolean;
  v_day      date;
  v_key      text;
  v_body     text;
  v_id       uuid;
  v_shown    text;
  v_prev     text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- The same two lists strength_leaderboard (0101) validates against.
  if p_metric not in ('weight','time','reps','distance','calories') then
    raise exception 'Unknown metric %', p_metric;
  end if;
  if p_better not in ('higher','lower') then
    raise exception 'Unknown direction %', p_better;
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  v_value := case when p_metric = 'time'
                  then p_value_seconds::numeric
                  else p_value_numeric end;
  if v_value is null then
    return null;
  end if;

  -- The prior best, from what is stored — never from what the client
  -- claims. Both halves of the journal count: a result logged directly
  -- and one tagged inside a workout section are the same lift.
  select case when p_better = 'higher' then max(v) else min(v) end
    into v_prior
  from (
    select case when p_metric = 'time'
                then r.value_seconds::numeric
                else r.value_numeric end as v
      from public.tracked_movement_results r
     where r.profile_id = v_uid
       and r.track_key = p_track_key
       and r.performed_at < p_performed_at
    union all
    select case when p_metric = 'time'
                then e.time_seconds::numeric
                else e.weight_numeric end as v
      from public.tracked_section_movement_tags t
      join public.tracked_workout_sections s on s.id = t.section_id
      join public.tracked_section_entries e on e.section_id = s.id
      join public.tracked_workouts w on w.id = s.workout_id
     where w.profile_id = v_uid
       and t.track_key = p_track_key
       and t.performed_at < p_performed_at
  ) prior
  where v is not null;

  -- A first-ever log is not a personal best. It is the best so far,
  -- which is what the badge means and not what a message would.
  if v_prior is null then
    return null;
  end if;

  v_beats := case when p_better = 'higher'
                  then v_value > v_prior
                  else v_value < v_prior end;
  if not v_beats then
    return null;
  end if;

  v_day := coalesce(p_local_day, (p_performed_at at time zone 'UTC')::date);
  v_key := v_uid::text || ':' || p_track_key || ':' || v_day::text;

  -- FM trims the padding but leaves a trailing point on a whole
  -- number ("100."), which reads as a typo in a sentence.
  v_shown := case when p_metric = 'time'
                  then to_char((p_value_seconds || ' seconds')::interval, 'MI:SS')
                  else rtrim(trim(to_char(v_value, 'FM999999990.99')), '.')
                       || coalesce(' ' || p_value_unit, '') end;
  v_prev := case when p_metric = 'time'
                 then to_char((v_prior::integer || ' seconds')::interval, 'MI:SS')
                 else rtrim(trim(to_char(v_prior, 'FM999999990.99')), '.')
                      || coalesce(' ' || p_value_unit, '') end;
  v_body := v_shown || ' — up from ' || v_prev || '.';

  insert into public.member_milestones
    (gym_id, profile_id, kind, movement_key, track_key,
     value_numeric, value_seconds, previous_numeric, previous_seconds,
     value_unit, body, performed_at, idempotency_key)
  values
    (p_gym_id, v_uid, 'personal_best', p_movement_key, p_track_key,
     p_value_numeric, p_value_seconds,
     case when p_metric = 'time' then null else v_prior end,
     case when p_metric = 'time' then v_prior::integer else null end,
     p_value_unit, v_body, p_performed_at, v_key)
  on conflict (idempotency_key) do update
    set value_numeric    = excluded.value_numeric,
        value_seconds    = excluded.value_seconds,
        previous_numeric = excluded.previous_numeric,
        previous_seconds = excluded.previous_seconds,
        body             = excluded.body,
        performed_at     = excluded.performed_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_personal_best(
  uuid, text, text, text, text, numeric, integer, text, timestamptz, date
) from public, anon;
grant execute on function public.record_personal_best(
  uuid, text, text, text, text, numeric, integer, text, timestamptz, date
) to authenticated;

create function public.mark_milestones_read(p_gym_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.member_milestones
     set read_at = now()
   where gym_id = p_gym_id
     and profile_id = auth.uid()
     and read_at is null;
$$;

revoke all on function public.mark_milestones_read(uuid) from public, anon;
grant execute on function public.mark_milestones_read(uuid) to authenticated;

-- The bell gains a sixth source. Dropped and recreated wholesale, as
-- 0169 and 0175 each did when they added theirs — the RETURNS shape
-- changes, so CREATE OR REPLACE cannot.
drop function if exists public.inbox_unread_summary();

create function public.inbox_unread_summary()
returns table (
  dm_unread              integer,
  announcement_unread    integer,
  class_broadcast_unread integer,
  class_change_unread    integer,
  payment_unread         integer,
  milestone_unread       integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::int from public.direct_messages
      where recipient_id = auth.uid() and read_at is null
    ),
    (
      select count(*)::int from public.gym_announcements a
      where exists (
        select 1 from public.gym_memberships gm
        where gm.gym_id = a.gym_id
          and gm.profile_id = auth.uid()
          and gm.left_at is null
      )
      and not exists (
        select 1 from public.announcement_reads r
        where r.announcement_id = a.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_session_broadcasts cb
      where exists (
        select 1 from public.class_bookings b
        where b.class_session_id = cb.class_session_id
          and b.profile_id = auth.uid()
      )
      and not exists (
        select 1 from public.class_session_broadcast_reads r
        where r.broadcast_id = cb.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_change_notifications n
      where n.channel = 'in_app'
        and n.recipient_profile_id = auth.uid()
        and n.read_at is null
    ),
    (
      select count(*)::int from public.payment_notifications n
      where n.channel = 'in_app'
        and n.recipient_profile_id = auth.uid()
        and n.read_at is null
    ),
    (
      select count(*)::int from public.member_milestones m
      where m.profile_id = auth.uid()
        and m.read_at is null
    );
$$;

grant execute on function public.inbox_unread_summary() to authenticated;

commit;
