-- Make the uncovered-class warning lead time a per-gym setting.
--
-- 0166 shipped it as a 48-hour constant with a note that it could become
-- a dial if a gym asked. It's being asked for. 48 hours suits a gym with
-- a deep bench; a two-coach studio wants a week's notice, and a gym that
-- finds the warning noisy wants it off entirely.
--
-- 0 means off — no sweep, no warning — mirroring how
-- booking_window_hours_ahead treats 0 as "no window". The ceiling is two
-- weeks: past that the warning stops being a warning and becomes the
-- request notification again, which 0165 already sends.
--
-- Existing gyms are backfilled to 48 by the column default, so nothing
-- changes for anyone until an owner touches it.
--
-- set_gym_operating_defaults grows a parameter → arity change → DROP
-- first, per the 0043 lesson (and the same dance 0128 did).

begin;

-- ============================================================================
-- 1. gyms.cover_warning_hours
-- ============================================================================

alter table public.gyms
  add column if not exists cover_warning_hours integer not null default 48
    check (cover_warning_hours between 0 and 336);

-- ============================================================================
-- 2. warn_uncovered_cover reads the gym's own lead
-- ============================================================================
--
-- Same body as 0166 but for the lead: joined per gym rather than a
-- local constant, and gyms set to 0 drop out of the sweep entirely.

create or replace function public.warn_uncovered_cover()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with at_risk as (
    select distinct cr.id as request_id, cr.gym_id, cr.requested_by
    from public.cover_requests cr
    join public.gyms g on g.id = cr.gym_id
    join public.cover_request_sessions crs on crs.request_id = cr.id
    join public.class_sessions cs on cs.id = crs.class_session_id
    where cr.status in ('open', 'partial')
      and g.cover_warning_hours > 0
      and crs.claimed_by is null
      and cs.starts_at > now()
      and cs.starts_at <= now() + make_interval(hours => g.cover_warning_hours)
  ),
  recipient as (
    select distinct r.request_id, r.gym_id, p.profile_id
    from at_risk r
    cross join lateral (
      select r.requested_by as profile_id
      union
      select m.profile_id
      from public.gym_memberships m
      where m.gym_id = r.gym_id
        and m.role in ('owner', 'admin')
        and m.left_at is null
    ) p
  )
  insert into public.cover_notifications
    (gym_id, request_id, kind, channel, recipient, recipient_profile_id,
     status, sent_at, error, idempotency_key)
  select
    rc.gym_id, rc.request_id, 'cover_uncovered', c.channel,
    case when c.channel = 'in_app' then rc.profile_id::text else u.email end,
    rc.profile_id,
    case
      when c.channel = 'in_app' then 'sent'
      when u.email is null then 'skipped'
      when public._email_blanket_unsubscribed(rc.gym_id, u.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and u.email is null
        then 'Coach has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(rc.gym_id, u.email)
        then 'Coach has unsubscribed from all email from this gym'
    end,
    c.channel || ':uncovered:' || rc.request_id || ':' || rc.profile_id || ':'
      || (now() at time zone g.timezone)::date
  from recipient rc
  join public.gyms g on g.id = rc.gym_id
  left join auth.users u on u.id = rc.profile_id
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function public.warn_uncovered_cover()
  from public, anon, authenticated;

-- ============================================================================
-- 3. set_gym_operating_defaults — one more parameter
-- ============================================================================

drop function if exists public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  text, integer, integer, integer, text, text, integer
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
  p_cancel_cutoff_days_before       integer default 1,
  p_cover_warning_hours             integer default 48
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
  if p_cover_warning_hours is null
     or p_cover_warning_hours < 0
     or p_cover_warning_hours > 336 then
    raise exception 'Cover warning lead must be between 0 and 336 hours';
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
        cover_warning_hours             = p_cover_warning_hours,
        operating_defaults_reviewed_at  = now()
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_operating_defaults(
  uuid, text, text, integer, integer, integer, integer, integer, integer,
  text, integer, integer, integer, text, text, integer, integer
) to authenticated;

commit;
