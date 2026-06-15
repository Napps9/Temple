-- Move the "cancel by a set time, days before" cutoff from gym-wide to
-- per-class-type. A 6:30am CrossFit class wants "cancel by 9pm the
-- night before" so members don't book overnight and miss it; a 6pm
-- yoga class is happy with the gym's plain relative cutoff. The mode
-- only makes sense at class-type granularity.
--
-- After this migration:
--   - class_types gains the same cancel_cutoff_mode / time / days_before
--     trio that 0071 added to gyms
--   - Refund-on-cancel trigger checks class_type's day_before first,
--     then class_type's relative override, then gym relative default
--   - gym.cancel_cutoff_mode is no longer consulted by the trigger
--     (the column stays so set_gym_operating_defaults keeps its 17-arg
--     shape — UI stops surfacing the mode and always sends 'relative')

begin;

alter table public.class_types
  add column if not exists cancel_cutoff_mode text
    check (cancel_cutoff_mode is null
           or cancel_cutoff_mode in ('relative', 'day_before')),
  add column if not exists cancel_cutoff_time time,
  add column if not exists cancel_cutoff_days_before integer
    check (cancel_cutoff_days_before is null
           or cancel_cutoff_days_before >= 0);

-- Reset any gym that had picked day_before mode back to relative. The
-- UI no longer exposes the mode at gym level and the trigger ignores
-- it; setting it back keeps the data honest.
update public.gyms
  set cancel_cutoff_mode = 'relative'
  where cancel_cutoff_mode = 'day_before';

-- ============================================================================
-- _refund_on_booking_delete — new precedence
-- ============================================================================
--
-- 1. class_type.cancel_cutoff_mode = 'day_before'
--    → absolute cutoff per class type, computed in the gym timezone
-- 2. class_type.cancel_cutoff_minutes_before is not null
--    → class type's relative override
-- 3. gym.cancel_cutoff_minutes_before
--    → gym-wide relative default
--
-- Admin-skip flag (current_setting('temple.skip_booking_refund')) and
-- timezone fallback to UTC behave exactly as before.

create or replace function public._refund_on_booking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ct_relative integer;
  v_ct_mode     text;
  v_ct_time     time;
  v_ct_days     integer;
  v_starts_at   timestamptz;
  v_ct_id       uuid;
  v_gym_rel     integer;
  v_tz          text;
  v_cutoff_ts   timestamptz;
begin
  if coalesce(current_setting('temple.skip_booking_refund', true), 'off') = 'on' then
    return old;
  end if;

  select starts_at, class_type_id
    into v_starts_at, v_ct_id
    from public.class_sessions
    where id = old.class_session_id;
  if v_starts_at is null then
    return old;
  end if;

  select cancel_cutoff_minutes_before,
         cancel_cutoff_mode,
         cancel_cutoff_time,
         cancel_cutoff_days_before
    into v_ct_relative, v_ct_mode, v_ct_time, v_ct_days
    from public.class_types where id = v_ct_id;

  select cancel_cutoff_minutes_before,
         coalesce(nullif(timezone, ''), 'UTC')
    into v_gym_rel, v_tz
    from public.gyms where id = old.gym_id;

  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  -- 1. Class-type day_before mode wins outright.
  if v_ct_mode = 'day_before' and v_ct_time is not null then
    v_cutoff_ts :=
      (((v_starts_at at time zone v_tz)::date - coalesce(v_ct_days, 1)) + v_ct_time)
        at time zone v_tz;
    if now() >= v_cutoff_ts then
      return old;
    end if;
  -- 2. Class-type relative override.
  elsif v_ct_relative is not null then
    if v_ct_relative > 0
       and v_starts_at - make_interval(mins => v_ct_relative) <= now()
    then
      return old;
    end if;
  -- 3. Gym relative default.
  elsif coalesce(v_gym_rel, 0) > 0
        and v_starts_at - make_interval(mins => v_gym_rel) <= now()
  then
    return old;
  end if;

  perform public._refund_booking_credit(old.class_session_id, old.profile_id);
  return old;
end;
$$;

revoke execute on function public._refund_on_booking_delete()
  from public, anon, authenticated;

commit;
