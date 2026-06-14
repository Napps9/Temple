-- Absolute "cancel by a set time" cutoff for the free-cancel window.
--
-- Until now the free-cancel cutoff was purely relative: forfeit the
-- credit if the cancel lands within N minutes of class start. Gyms
-- commonly run an absolute policy instead — "cancel by 9pm the night
-- before" — which a relative offset can't express (the gap between
-- 9pm-the-night-before and class start varies by class time).
--
-- This adds a gym-wide mode on the cancel cutoff:
--   relative   — existing behaviour (cancel_cutoff_minutes_before).
--   day_before — forfeit once now() passes <time>, <days> before the
--                class's own local date. Anchored per-class to the
--                class date, computed in the gym's timezone.
--
-- Scope decisions (confirmed with the owner): absolute mode applies to
-- the free-cancel cutoff only (booking open/close stay relative), and
-- is gym-wide. The per-class-type relative override (0063) still wins
-- when set, so a class type can opt out of the gym policy with its own
-- relative cutoff.

begin;

-- ============================================================================
-- 1. gyms columns
-- ============================================================================

alter table public.gyms
  add column if not exists cancel_cutoff_mode text not null default 'relative'
    check (cancel_cutoff_mode in ('relative', 'day_before')),
  add column if not exists cancel_cutoff_time time,
  add column if not exists cancel_cutoff_days_before integer not null default 1
    check (cancel_cutoff_days_before >= 0);

-- ============================================================================
-- 2. set_gym_operating_defaults — three new params (arity change → drop)
-- ============================================================================

drop function if exists public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  integer, text, integer, integer, integer
);

create function public.set_gym_operating_defaults(
  p_gym_id                          uuid,
  p_week_starts_on                  text,
  p_timezone                        text,
  p_default_class_capacity          integer,
  p_default_class_minutes           integer,
  p_expiring_within_days            integer,
  p_parq_expiry_days                integer,
  p_health_retention_months         integer,
  p_lead_conversion_window_days     integer,
  p_materialisation_horizon_weeks   integer,
  p_subscription_resolution         text,
  p_booking_window_hours_ahead      integer default null,
  p_booking_cutoff_minutes_before   integer default 0,
  p_cancel_cutoff_minutes_before    integer default 0,
  p_cancel_cutoff_mode              text    default 'relative',
  p_cancel_cutoff_time              text    default null,
  p_cancel_cutoff_days_before       integer default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_time time;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change operating defaults';
  end if;
  if p_cancel_cutoff_mode not in ('relative', 'day_before') then
    raise exception 'Invalid cancel cutoff mode';
  end if;
  v_time := case
    when nullif(p_cancel_cutoff_time, '') is null then null
    else p_cancel_cutoff_time::time
  end;
  if p_cancel_cutoff_mode = 'day_before' and v_time is null then
    raise exception 'Pick a cancellation time for the day-before cutoff';
  end if;

  update public.gyms
    set week_starts_on                  = p_week_starts_on,
        timezone                        = p_timezone,
        default_class_capacity          = p_default_class_capacity,
        default_class_minutes           = p_default_class_minutes,
        expiring_within_days            = p_expiring_within_days,
        parq_expiry_days                = p_parq_expiry_days,
        health_retention_months         = p_health_retention_months,
        lead_conversion_window_days     = p_lead_conversion_window_days,
        materialisation_horizon_weeks   = p_materialisation_horizon_weeks,
        subscription_resolution         = p_subscription_resolution,
        booking_window_hours_ahead      = p_booking_window_hours_ahead,
        booking_cutoff_minutes_before   = p_booking_cutoff_minutes_before,
        cancel_cutoff_minutes_before    = p_cancel_cutoff_minutes_before,
        cancel_cutoff_mode              = p_cancel_cutoff_mode,
        cancel_cutoff_time              = v_time,
        cancel_cutoff_days_before       = p_cancel_cutoff_days_before,
        operating_defaults_reviewed_at  = now()
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  integer, text, integer, integer, integer, text, text, integer
) to authenticated;

-- ============================================================================
-- 3. Refund trigger honours the absolute cutoff
-- ============================================================================
--
-- Precedence, highest first:
--   1. class_types.cancel_cutoff_minutes_before (relative override)
--   2. gym day_before mode (absolute, computed in the gym timezone)
--   3. gym cancel_cutoff_minutes_before (relative default)
-- A bad/empty gyms.timezone falls back to UTC so a typo can never wedge
-- the cancel path.

create or replace function public._refund_on_booking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ct_cutoff integer;
  v_starts_at timestamptz;
  v_ct_id     uuid;
  v_mode      text;
  v_time      time;
  v_days      integer;
  v_rel       integer;
  v_tz        text;
  v_cutoff_ts timestamptz;
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

  select cancel_cutoff_minutes_before into v_ct_cutoff
    from public.class_types where id = v_ct_id;

  -- 1. Class-type relative override wins outright.
  if v_ct_cutoff is not null then
    if v_ct_cutoff > 0
       and v_starts_at - make_interval(mins => v_ct_cutoff) <= now()
    then
      return old;
    end if;
    perform public._refund_booking_credit(old.class_session_id, old.profile_id);
    return old;
  end if;

  select cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_days_before,
         cancel_cutoff_minutes_before, coalesce(nullif(timezone, ''), 'UTC')
    into v_mode, v_time, v_days, v_rel, v_tz
    from public.gyms where id = old.gym_id;

  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  -- 2. Absolute day-before cutoff, anchored to the class's local date.
  if v_mode = 'day_before' and v_time is not null then
    v_cutoff_ts :=
      (((v_starts_at at time zone v_tz)::date - coalesce(v_days, 1)) + v_time)
        at time zone v_tz;
    if now() >= v_cutoff_ts then
      return old;
    end if;
  -- 3. Relative gym default.
  elsif coalesce(v_rel, 0) > 0
        and v_starts_at - make_interval(mins => v_rel) <= now()
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
