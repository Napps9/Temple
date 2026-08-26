-- Time with a coach
--
-- Everything bookable in Temple is a class. An intro, a consult, a PT
-- hour and a form check are not classes, and today they ride the timetable
-- as a class of one plus a lead card nobody links to it — which is why
-- "intro_booked" has been a status with no time, no coach and no session
-- attached since 0056.
--
-- IT IS STILL A CLASS SESSION, AND THAT IS THE DESIGN. Capacity 1 has
-- always been legal. Bookings, the waitlist, cancellation, class-change
-- notifications, entitlements, check-in and the whole booking gate already
-- hang off class_sessions, and an appointment differs from a class in
-- exactly two ways: how many people fit, and who picks the time. Neither
-- is a reason for a second table that would need every one of those
-- rebuilt beside it.
--
-- SO WHAT IS ACTUALLY NEW IS AVAILABILITY. Nothing in the product knows
-- when a coach is around: gym_hours is gym-wide, cover offers are reactive
-- (a named session needs covering), and coach_class_type_qualifications
-- says what somebody can teach, not when. coach_availability is a standing
-- weekly pattern per coach per appointment type, and appointment_slots
-- expands it against what is already booked.
--
-- SLOTS ARE COMPUTED, NEVER MATERIALISED AHEAD. The timetable
-- materialises recurrences into rows because a class exists whether or not
-- anyone books it. An appointment does not exist until somebody takes it,
-- and writing a year of empty capacity-1 sessions would put a thousand
-- phantom classes into every count, every calendar and every attendance
-- figure in the product. The row is created by the booking.
--
-- WHICH MAKES THE RACE THE ONE THING TO GET RIGHT. Two people tapping the
-- same 9am is find-or-create on a row that does not exist yet, so the
-- usual `for update` has nothing to lock. A transaction-scoped advisory
-- lock on (gym, coach, start) is the lock that can exist before the row
-- does; _book_class_for's own capacity check then holds the line as it
-- always has.

begin;

-- ============================================================================
-- 1. An appointment type
-- ============================================================================

alter table public.class_types
  add column if not exists is_appointment boolean not null default false,
  add column if not exists appointment_minutes integer
    check (appointment_minutes is null or appointment_minutes between 5 and 480);

comment on column public.class_types.is_appointment is
  'One-to-one time rather than a class: capacity 1, the member picks the '
  'slot, and it is filtered out of the class timetable.';

-- ============================================================================
-- 2. When a coach is around
-- ============================================================================

create table public.coach_availability (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  coach_id      uuid not null references public.profiles(id) on delete cascade,
  class_type_id uuid not null references public.class_types(id) on delete cascade,
  -- 0 = Sunday, matching gym_hours (0003) and class_recurrences (0005).
  -- A third convention in one schema is how a Monday becomes a Sunday.
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  starts_at     time not null,
  ends_at       time not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index coach_availability_lookup_idx
  on public.coach_availability(gym_id, class_type_id, day_of_week)
  where active;

alter table public.coach_availability enable row level security;

-- Members need to read it to see what is bookable; only staff who run the
-- timetable may write it.
create policy coach_availability_tenant_select on public.coach_availability
  for select using (public.user_belongs_to(gym_id));

create policy coach_availability_staff_write on public.coach_availability
  for all
  using (public.effective_can(gym_id, 'can_edit_classes'))
  with check (public.effective_can(gym_id, 'can_edit_classes'));

-- ============================================================================
-- 3. What is free
-- ============================================================================

create or replace function public.appointment_slots(
  p_gym_id        uuid,
  p_class_type_id uuid,
  p_from          date,
  p_to            date
) returns table (
  starts_at timestamptz,
  coach_id  uuid,
  coach_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_minutes integer;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  -- A month at a time. An unbounded range would expand a standing weekly
  -- pattern for as long as somebody typed.
  if p_to < p_from or p_to > p_from + 62 then
    raise exception 'Ask for a range of up to two months';
  end if;

  select case when exists (select 1 from pg_timezone_names t where t.name = g.timezone)
              then g.timezone else 'UTC' end
    into v_tz
    from public.gyms g where g.id = p_gym_id;

  select coalesce(ct.appointment_minutes, 30) into v_minutes
    from public.class_types ct
   where ct.id = p_class_type_id
     and ct.gym_id = p_gym_id
     and ct.is_appointment
     and ct.archived_at is null;
  if v_minutes is null then
    return;
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  windows as (
    select days.day, a.coach_id, a.starts_at, a.ends_at
      from days
      join public.coach_availability a
        on a.gym_id = p_gym_id
       and a.class_type_id = p_class_type_id
       and a.active
       and a.day_of_week = extract(dow from days.day)::int
      -- A gym closure closes one-to-one time too. Somebody arriving for a
      -- consult on a day the door is locked is the worst version of this.
      where not exists (
        select 1 from public.gym_closures c
        where c.gym_id = p_gym_id
          and days.day between c.starts_on and c.ends_on
      )
  ),
  candidates as (
    select
      ((w.day + w.starts_at) + make_interval(mins => v_minutes * n.i))
        at time zone v_tz as slot_at,
      w.coach_id
    from windows w
    cross join lateral generate_series(
      0,
      greatest(0, (extract(epoch from (w.ends_at - w.starts_at)) / 60
                   / v_minutes)::int - 1)
    ) as n(i)
  )
  select c.slot_at, c.coach_id, coalesce(p.full_name, 'A coach')
    from candidates c
    join public.profiles p on p.id = c.coach_id
   where c.slot_at > now()
     -- Taken: a session already exists at that moment for that coach.
     and not exists (
       select 1 from public.class_sessions s
       where s.gym_id = p_gym_id
         and s.coach_id = c.coach_id
         and s.starts_at = c.slot_at
     )
   order by c.slot_at, coalesce(p.full_name, '');
end;
$$;

revoke all on function public.appointment_slots(uuid, uuid, date, date) from public, anon;
grant execute on function public.appointment_slots(uuid, uuid, date, date) to authenticated;

-- ============================================================================
-- 4. Taking one
-- ============================================================================

create or replace function public.book_appointment(
  p_gym_id        uuid,
  p_class_type_id uuid,
  p_coach_id      uuid,
  p_starts_at     timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_ct      record;
  v_session uuid;
  v_booking uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  select ct.id, ct.name, coalesce(ct.appointment_minutes, 30) as minutes
    into v_ct
    from public.class_types ct
   where ct.id = p_class_type_id
     and ct.gym_id = p_gym_id
     and ct.is_appointment
     and ct.archived_at is null;
  if v_ct.id is null then
    raise exception 'That is not a bookable appointment';
  end if;

  -- The lock that can exist before the row does. Two people tapping the
  -- same 9am both find no session and both create one; find-or-create has
  -- nothing to `for update` until it is too late.
  perform pg_advisory_xact_lock(
    hashtextextended(p_gym_id::text || p_coach_id::text
                     || extract(epoch from p_starts_at)::bigint::text, 0)
  );

  if not exists (
    select 1 from public.appointment_slots(
      p_gym_id, p_class_type_id, (p_starts_at at time zone 'UTC')::date - 1,
      (p_starts_at at time zone 'UTC')::date + 1)
    where starts_at = p_starts_at and coach_id = p_coach_id
  ) then
    raise exception 'That time is not available';
  end if;

  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values
    (p_gym_id, v_ct.name, p_coach_id, p_starts_at, v_ct.minutes, 1,
     v_uid, p_class_type_id)
  returning id into v_session;

  -- Every gate a class booking passes — waiver, PAR-Q, entitlement,
  -- membership, capacity — applies unchanged. An appointment is not a way
  -- around any of them.
  v_booking := public._book_class_for(v_session, v_uid);

  return v_booking;
end;
$$;

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz) to authenticated;

commit;
