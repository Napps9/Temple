-- Phase 1 / Track G: class check-ins (§6.3).
--
-- One row per booking that actually got attended. Bookings without
-- a matching row are no-shows, which the next refresh of
-- mv_attendance_weekly picks up.
--
-- Staff (Owner/Coach/Staff via can_check_in_member) write check-ins;
-- members read their own (a member can see their own attendance
-- history). Idempotent: check-in twice is a no-op via the PK.
--
-- Carries a denormalised gym_id so RLS doesn't have to walk through
-- the booking row on every read.

create table public.class_check_ins (
  booking_id     uuid primary key references public.class_bookings(id) on delete cascade,
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  checked_in_by  uuid not null references public.profiles(id),
  checked_in_at  timestamptz not null default now()
);

create index class_check_ins_gym_idx     on public.class_check_ins(gym_id, checked_in_at desc);
create index class_check_ins_profile_idx on public.class_check_ins(profile_id);

-- Match-parent trigger: the (gym_id, profile_id) on the check-in
-- row must agree with the parent class_bookings row. Catches the
-- accident where a wrong booking_id leaks across gyms.
create or replace function public.fn_class_check_in_match_parent()
returns trigger
language plpgsql
as $$
declare
  v_gym_id     uuid;
  v_profile_id uuid;
begin
  select gym_id, profile_id
    into v_gym_id, v_profile_id
  from public.class_bookings
  where id = new.booking_id;
  if v_gym_id is null then
    raise exception 'class_check_ins.booking_id % not found', new.booking_id;
  end if;
  if v_gym_id <> new.gym_id then
    raise exception 'class_check_ins.gym_id does not match parent booking';
  end if;
  if v_profile_id <> new.profile_id then
    raise exception 'class_check_ins.profile_id does not match parent booking';
  end if;
  return new;
end;
$$;

create trigger class_check_ins_match_parent_trg
  before insert or update on public.class_check_ins
  for each row execute function public.fn_class_check_in_match_parent();

alter table public.class_check_ins enable row level security;

create policy class_check_ins_self_select on public.class_check_ins
  for select using (profile_id = auth.uid());

create policy class_check_ins_staff_select on public.class_check_ins
  for select using (public.user_can_assign_plan(gym_id));

-- Staff can insert and delete (delete = undo a mistaken check-in).
-- can_check_in_member maps to user_can_assign_plan via the
-- capability matrix.
create policy class_check_ins_staff_insert on public.class_check_ins
  for insert with check (public.user_can_assign_plan(gym_id));
create policy class_check_ins_staff_delete on public.class_check_ins
  for delete using (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- Extend mv_attendance_weekly with no-show count.
-- ============================================================================

drop materialized view public.mv_attendance_weekly;

create materialized view public.mv_attendance_weekly as
  select
    cs.gym_id,
    date_trunc('week', cs.starts_at)::date as week_start,
    cs.class_type_id,
    count(cb.id)::integer as bookings_count,
    count(ci.booking_id)::integer as checked_in_count,
    (count(cb.id) - count(ci.booking_id))::integer as no_show_count,
    count(distinct cb.profile_id)::integer as unique_members
  from public.class_sessions cs
  join public.class_bookings cb on cb.class_session_id = cs.id
  left join public.class_check_ins ci on ci.booking_id = cb.id
  where cs.starts_at < now()
  group by cs.gym_id, date_trunc('week', cs.starts_at), cs.class_type_id;

create unique index mv_attendance_weekly_pk
  on public.mv_attendance_weekly(gym_id, week_start, class_type_id);

-- Refresh the view immediately so the new columns are populated
-- before the next cron tick.
refresh materialized view public.mv_attendance_weekly;

-- Update the accessor to expose the new columns.
create or replace function public.get_attendance_weekly(
  p_gym_id uuid,
  p_weeks  integer default 12
) returns table (
  week_start       date,
  class_type_id    uuid,
  class_type_name  text,
  bookings_count   integer,
  checked_in_count integer,
  no_show_count    integer,
  unique_members   integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  return query
    select
      a.week_start,
      a.class_type_id,
      ct.name,
      a.bookings_count,
      a.checked_in_count,
      a.no_show_count,
      a.unique_members
    from public.mv_attendance_weekly a
    left join public.class_types ct on ct.id = a.class_type_id
    where a.gym_id = p_gym_id
      and a.week_start >= (current_date - (p_weeks || ' weeks')::interval)::date
    order by a.week_start desc, ct.name;
end;
$$;
