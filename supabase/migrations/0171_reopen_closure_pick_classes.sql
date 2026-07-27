-- Reopening a closure class by class.
--
-- lift_gym_closure (0169) was all-or-nothing: end the closure, put every
-- recurring class back. The case it could not express is the one that
-- actually comes up — "we're shut 22 Dec to 3 Jan, but we'll run open gym
-- on the 28th and 30th". Doing that meant lifting the whole window and
-- re-cancelling everything else, which refunds nobody (the classes were
-- never booked) but does leave the dates open for anything to be scheduled
-- into.
--
-- So reopening becomes selective, and the closure survives it. Ticking
-- every class still ends the closure outright — if nothing is being held
-- back there is nothing left for it to hold. Leaving any class unticked
-- keeps the closure live, so the dates it still covers stay shut against
-- new classes as well as old ones. That is the same shape as the create
-- flow's p_exclude_session_ids: the closure holds, with named exceptions.
--
-- The classes being reopened do not exist to be listed — the closure
-- deleted them. preview_closure_reopen recomputes them from the patterns
-- instead, which is also what the restore inserts from, so the list the
-- operator ticks is the list that gets created.
--
-- Sections:
--   1. _suppress_session_in_closure — honour a restore-in-progress flag
--   2. preview_closure_reopen       — what would come back
--   3. reopen_closure               — replaces lift_gym_closure

begin;

-- ============================================================================
-- 1. Let a deliberate restore through the closure trigger
-- ============================================================================
--
-- Transaction-local GUC, same device as temple.skip_booking_refund (0065).
-- Restoring a class into a live closure is the one insert that is allowed
-- to land inside the window, and it is only ever set by reopen_closure
-- below — a client cannot reach it, because RLS still governs the insert
-- and the flag is scoped to this transaction.
--
-- Body is otherwise 0169 verbatim.

create or replace function public._suppress_session_in_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.gym_closures;
  v_tz      text;
  v_why     text;
begin
  if coalesce(current_setting('temple.restoring_closed_class', true), 'off') = 'on' then
    return new;
  end if;

  -- Backfilling history into a past closure window is legitimate (an
  -- attendance correction, an import). Only future classes are suppressed.
  if new.starts_at <= now() then
    return new;
  end if;

  select timezone into v_tz from public.gyms where id = new.gym_id;
  if v_tz is null then
    return new;
  end if;

  select c.* into v_closure
  from public.gym_closures c
  where c.gym_id = new.gym_id
    and c.lifted_at is null
    and new.starts_at >= (c.starts_on::text || ' 00:00')::timestamp at time zone v_tz
    and new.starts_at <  ((c.ends_on + 1)::text || ' 00:00')::timestamp at time zone v_tz
  order by c.created_at
  limit 1;

  if v_closure.id is null then
    return new;
  end if;

  if new.recurrence_id is not null then
    return null;
  end if;

  v_why := 'The gym is closed from '
    || to_char(v_closure.starts_on, 'FMDD Mon')
    || ' to ' || to_char(v_closure.ends_on, 'FMDD Mon')
    || case when v_closure.reason is null then ''
            else ' (' || v_closure.reason || ')' end;
  raise exception '%', v_why using errcode = 'P0001';
end;
$$;

-- ============================================================================
-- 2. preview_closure_reopen
-- ============================================================================
--
-- Walks each live schedule across the closure and returns the slots it
-- would produce. Mirrors extend_recurrence's rules — archived class types
-- produce nothing, ends_on bounds the span — and skips slots that already
-- hold a class, which is how a session excluded at closure time, or
-- restored by an earlier reopen, stays out of the list.
--
-- Past slots are excluded: a closure being reopened part-way through
-- cannot un-cancel yesterday.

create or replace function public.preview_closure_reopen(p_closure_id uuid)
returns table (
  recurrence_id    uuid,
  starts_at        timestamptz,
  class_type_name  text,
  duration_minutes integer,
  capacity         integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    s.sa,
    ct.name,
    r.duration_minutes,
    r.capacity
  from public.gym_closures c
  join public.class_recurrences r on r.gym_id = c.gym_id
  join public.class_types ct
    on ct.id = r.class_type_id and ct.archived_at is null
  cross join lateral generate_series(
    greatest(c.starts_on, r.starts_on)::timestamp,
    least(c.ends_on, coalesce(r.ends_on, c.ends_on))::timestamp,
    interval '1 day') d
  cross join lateral unnest(r.times) t
  cross join lateral (
    select ((d::date::text || ' ' || t)::timestamp at time zone r.tz) as sa
  ) s
  where c.id = p_closure_id
    and c.lifted_at is null
    and public.effective_can(c.gym_id, 'can_bulk_edit_classes')
    and extract(dow from d)::int = any(r.days_of_week)
    and s.sa > now()
    and not exists (
      select 1 from public.class_sessions cs
      where cs.recurrence_id = r.id and cs.starts_at = s.sa
    )
  order by 2, 3;
$$;

grant execute on function public.preview_closure_reopen(uuid) to authenticated;

-- ============================================================================
-- 3. reopen_closure
-- ============================================================================
--
-- Arity changes, and CREATE OR REPLACE cannot do that (0043), so the old
-- name goes. Nothing else called it.

drop function if exists public.lift_gym_closure(uuid);

create or replace function public.reopen_closure(
  p_closure_id uuid,
  p_exclude    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure  public.gym_closures;
  v_exclude  jsonb := coalesce(p_exclude, '[]'::jsonb);
  v_rec      record;
  v_before   integer;
  v_after    integer;
  v_restored integer := 0;
begin
  select * into v_closure from public.gym_closures where id = p_closure_id;
  if v_closure.id is null then
    raise exception 'Closure not found';
  end if;
  if not public.effective_can(v_closure.gym_id, 'can_bulk_edit_classes') then
    raise exception 'Not authorised';
  end if;
  if v_closure.lifted_at is not null then
    return jsonb_build_object('restored', 0, 'lifted', false);
  end if;
  if jsonb_typeof(v_exclude) <> 'array' then
    raise exception 'Excluded classes must be a list';
  end if;

  -- Nothing held back: the closure has no remaining purpose, so end it and
  -- re-materialise normally. Rewinding each cursor over the window and
  -- re-extending is what puts the classes back;
  -- class_sessions_recurrence_starts_unique plus extend_recurrence's own
  -- `on conflict do nothing` make re-walking already-materialised days a
  -- no-op, so only the deleted occurrences are re-created.
  --
  -- Bookings are NOT restored, whichever branch runs — the members were
  -- refunded and have to book again; a hard delete leaves nothing to
  -- reconstruct them from.
  if jsonb_array_length(v_exclude) = 0 then
    update public.gym_closures
      set lifted_at = now(), lifted_by = auth.uid()
      where id = p_closure_id;

    for v_rec in
      select id, materialized_until
      from public.class_recurrences
      where gym_id = v_closure.gym_id
        and materialized_until >= v_closure.starts_on
    loop
      select count(*)::int into v_before
        from public.class_sessions where recurrence_id = v_rec.id;

      update public.class_recurrences
        set materialized_until = (v_closure.starts_on - 1)
        where id = v_rec.id;
      perform public.extend_recurrence(v_rec.id, v_rec.materialized_until);

      select count(*)::int into v_after
        from public.class_sessions where recurrence_id = v_rec.id;
      v_restored := v_restored + (v_after - v_before);
    end loop;

    return jsonb_build_object('restored', v_restored, 'lifted', true);
  end if;

  -- Something is still being held back, so the closure stays live and only
  -- the ticked slots are written. The flag is what lets these past the
  -- suppression trigger; everything else in the window stays shut,
  -- including classes created later.
  perform set_config('temple.restoring_closed_class', 'on', true);

  insert into public.class_sessions
    (gym_id, name, class_type_id, recurrence_id, starts_at,
     duration_minutes, capacity, notes, coach_id, created_by)
  select
    r.gym_id, p.class_type_name, r.class_type_id, p.recurrence_id,
    p.starts_at, p.duration_minutes, p.capacity, r.notes,
    r.created_by, r.created_by
  from public.preview_closure_reopen(p_closure_id) p
  join public.class_recurrences r on r.id = p.recurrence_id
  where not exists (
    select 1 from jsonb_array_elements(v_exclude) e
    where (e ->> 'recurrence_id')::uuid    = p.recurrence_id
      and (e ->> 'starts_at')::timestamptz = p.starts_at
  )
  on conflict do nothing;

  get diagnostics v_restored = row_count;

  perform set_config('temple.restoring_closed_class', 'off', true);

  return jsonb_build_object('restored', coalesce(v_restored, 0), 'lifted', false);
end;
$$;

grant execute on function public.reopen_closure(uuid, jsonb) to authenticated;

commit;
