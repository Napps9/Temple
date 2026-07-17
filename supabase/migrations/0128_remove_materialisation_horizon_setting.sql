-- Remove "Class materialisation horizon" from the gym settings surface.
--
-- The dial never controlled anything an owner cares about: the calendar
-- extends every recurrence to max(visible month end, now + horizon) on
-- view, so browsing further ahead materialises those sessions regardless
-- of the value — it isn't a booking cap (booking windows are) or a
-- visibility cap. It was implementation plumbing leaking into the UI.
--
-- gyms.materialisation_horizon_weeks stays: the calendar still reads it
-- as the minimum pre-generated window (default 12 weeks). It just stops
-- being writable through set_gym_operating_defaults, whose horizon param
-- goes away. Arity change → drop first, per the 0043 lesson.

begin;

drop function if exists public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  integer, text, integer, integer, integer, text, text, integer
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
  text, integer, integer, integer, text, text, integer
) to authenticated;

commit;
