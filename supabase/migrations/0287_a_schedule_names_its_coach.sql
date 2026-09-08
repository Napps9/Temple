-- 0287: a schedule can name its coach, and its location reaches the classes.
--
-- Groundwork for editing a class "for this and all future". Two of the
-- fields that edit has to write have nowhere on the pattern to live, so
-- writing them onto the materialised sessions would hold only until the
-- next walk past materialized_until and then silently revert.
--
-- coach. class_recurrences has never had one, and extend_recurrence stamps
-- every session it creates with rec.created_by — so whoever built the
-- schedule is the coach of every class it will ever make, and the only
-- other writer of coach_id in the whole schema is claim_cover, which sets
-- it to auth.uid(). Nullable, and falling back to created_by, so every
-- schedule that exists keeps exactly the behaviour it has today; only a
-- schedule somebody has since given a coach reads differently.
--
-- location. On both class_sessions and class_recurrences since 0049, and
-- extend_recurrence has never carried it across — so a schedule's location
-- has been inert for that whole time: stored on the pattern, absent from
-- every class the pattern makes. Nobody noticed because nothing until now
-- offered to edit it, and a field that silently does nothing is worse once
-- there is a control for it.
--
-- The insert gains two columns and the function keeps its signature, so
-- CREATE OR REPLACE is enough. Body taken from 0170, the latest definition
-- — the clamp on start_at is 0170's and has to survive.

begin;

alter table public.class_recurrences
  add column if not exists coach_id uuid references public.profiles(id);

create or replace function public.extend_recurrence(
  rec_id uuid,
  until_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec       public.class_recurrences;
  cur_date  date;
  cur_time  text;
  start_at  date;
  end_at    date;
  v_archived_at timestamptz;
begin
  select * into rec from public.class_recurrences where id = rec_id;
  if rec is null then
    raise exception 'Recurrence not found';
  end if;

  if not public.user_belongs_to(rec.gym_id) then
    raise exception 'Not authorised';
  end if;

  select archived_at into v_archived_at
    from public.class_types
    where id = rec.class_type_id;
  if v_archived_at is not null then
    return;
  end if;

  start_at := greatest(
    coalesce(rec.materialized_until + 1, rec.starts_on), rec.starts_on);
  end_at   := least(until_date, coalesce(rec.ends_on, until_date));
  if start_at > end_at then
    return;
  end if;

  cur_date := start_at;
  while cur_date <= end_at loop
    if extract(dow from cur_date)::int = ANY(rec.days_of_week) then
      foreach cur_time in array rec.times loop
        insert into public.class_sessions (
          gym_id, name, class_type_id, recurrence_id, starts_at,
          duration_minutes, capacity, notes, location, coach_id, created_by
        )
        select
          rec.gym_id,
          ct.name,
          rec.class_type_id,
          rec.id,
          ((cur_date::text || ' ' || cur_time)::timestamp) at time zone rec.tz,
          rec.duration_minutes,
          rec.capacity,
          rec.notes,
          rec.location,
          coalesce(rec.coach_id, rec.created_by),
          rec.created_by
        from public.class_types ct
        where ct.id = rec.class_type_id
        on conflict do nothing;
      end loop;
    end if;
    cur_date := cur_date + interval '1 day';
  end loop;

  update public.class_recurrences
    set materialized_until = end_at
    where id = rec.id;
end;
$$;

grant execute on function public.extend_recurrence(uuid, date) to authenticated;

-- _clone_recurrence carries the pattern's own fields onto every split
-- 0170 makes. coach_id is one of those now: a split that dropped it would
-- hand the window's classes back to the schedule's author, which is the
-- revert this migration exists to stop. Same signature, so 0170's caller
-- is untouched.
create or replace function public._clone_recurrence(
  p_source_id          uuid,
  p_times              text[],
  p_duration_minutes   integer,
  p_capacity           integer,
  p_starts_on          date,
  p_ends_on            date,
  p_materialized_until date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     notes, starts_on, ends_on, tz, materialized_until, created_by, location,
     coach_id)
  select
    r.gym_id, r.class_type_id, r.days_of_week, p_times,
    coalesce(p_duration_minutes, r.duration_minutes),
    coalesce(p_capacity, r.capacity),
    r.notes, p_starts_on, p_ends_on, r.tz, p_materialized_until,
    r.created_by, r.location, r.coach_id
  from public.class_recurrences r
  where r.id = p_source_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function
  public._clone_recurrence(uuid, text[], integer, integer, date, date, date)
  from public, anon, authenticated;

commit;
