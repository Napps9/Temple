-- Add a "Gym settings" step to the new-owner setup checklist.
--
-- Every other checklist step (0039/0040) reads concrete state: a logo
-- exists, a class type exists, a plan exists. Operating defaults don't
-- work that way — the gyms row carries them from creation, so there's
-- no "absent → present" transition to key the step off. Instead we
-- record when the owner has actually opened and saved Gym settings at
-- least once, via a new gyms.operating_defaults_reviewed_at stamp set
-- inside set_gym_operating_defaults. The step is done once that stamp
-- is non-null.

begin;

alter table public.gyms
  add column if not exists operating_defaults_reviewed_at timestamptz;

-- set_gym_operating_defaults: same 14-arg signature, now also stamps
-- the review marker so the setup step can flip done. CREATE OR REPLACE
-- keeps the signature/grant from 0055 intact.

create or replace function public.set_gym_operating_defaults(
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
  p_cancel_cutoff_minutes_before    integer default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change operating defaults';
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
        operating_defaults_reviewed_at  = now()
    where id = p_gym_id;
end;
$$;

-- get_gym_setup_progress: add the 'settings' step. Done once the owner
-- has saved Gym settings at least once (stamp present).

create or replace function public.get_gym_setup_progress(p_gym_id uuid)
returns table (step_key text, done boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
    select 'logo'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and coalesce(logo_url, '') <> ''
      )
    union all
    select 'settings'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and operating_defaults_reviewed_at is not null
      )
    union all
    select 'class_type'::text,
      exists (
        select 1 from public.class_types
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'schedule'::text,
      exists (
        select 1
        from public.class_recurrences cr
        join public.class_types ct on ct.id = cr.class_type_id
        where cr.gym_id = p_gym_id and ct.archived_at is null
      )
    union all
    select 'parq'::text,
      exists (
        select 1 from public.parq_questionnaires
        where gym_id = p_gym_id and is_active
      )
      or exists (
        select 1 from public.waiver_documents
        where gym_id = p_gym_id and is_active
      )
    union all
    select 'plan'::text,
      exists (
        select 1 from public.membership_plans
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'team'::text,
      exists (
        select 1 from public.invite_codes
        where gym_id = p_gym_id
      )
      or exists (
        select 1 from public.gym_memberships
        where gym_id = p_gym_id
          and role in ('admin', 'coach', 'staff')
          and left_at is null
      );
end;
$$;

commit;
