-- Recurring class patterns + lazy materialisation
--
-- class_recurrences stores the *pattern* (days, times, duration, type, …)
-- so an indefinite-repeat class doesn't blow up storage. class_sessions
-- gains a recurrence_id back-reference and a partial-unique index so the
-- extender can use INSERT … ON CONFLICT DO NOTHING safely.
--
-- extend_recurrence(rec_id, until_date) is SECURITY DEFINER so any gym
-- member can lazily extend on view; RLS would otherwise block members.

create table public.class_recurrences (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  class_type_id      uuid not null references public.class_types(id) on delete cascade,
  days_of_week       int[] not null,                        -- 0=Sun … 6=Sat
  times              text[] not null,                       -- 'HH:MM' strings
  duration_minutes   int not null check (duration_minutes > 0),
  capacity           int not null check (capacity > 0),
  notes              text,
  starts_on          date not null,
  ends_on            date,                                  -- null = indefinite
  tz                 text not null default 'UTC',
  materialized_until date,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now()
);

create index class_recurrences_gym_id_idx on public.class_recurrences(gym_id);

alter table public.class_sessions
  add column recurrence_id uuid references public.class_recurrences(id) on delete set null;

create unique index class_sessions_recurrence_starts_unique
  on public.class_sessions(recurrence_id, starts_at)
  where recurrence_id is not null;

alter table public.class_recurrences enable row level security;

create policy class_recurrences_tenant_select on public.class_recurrences
  for select using (public.user_belongs_to(gym_id));

create policy class_recurrences_coach_insert on public.class_recurrences
  for insert with check (public.user_can_manage_classes(gym_id));

create policy class_recurrences_coach_update on public.class_recurrences
  for update using (public.user_can_manage_classes(gym_id))
  with check (public.user_can_manage_classes(gym_id));

create policy class_recurrences_coach_delete on public.class_recurrences
  for delete using (public.user_can_manage_classes(gym_id));

create or replace function public.extend_recurrence(rec_id uuid, until_date date)
returns void
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
begin
  select * into rec from public.class_recurrences where id = rec_id;
  if rec is null then
    raise exception 'Recurrence not found';
  end if;

  if not public.user_belongs_to(rec.gym_id) then
    raise exception 'Not authorised';
  end if;

  start_at := coalesce(rec.materialized_until + 1, rec.starts_on);
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
          duration_minutes, capacity, notes, coach_id, created_by
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
          rec.created_by,
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
