-- Manage-page dashboard counts: member snapshot and attendance attendees.
--
-- These exist so the manage page can show three at-a-glance tiles
-- (Revenue, Members, Attendance %) with mirror-period deltas. Revenue
-- already has compute_revenue_summary; the two functions below cover
-- the other two stats. Both are aggregate counts, so they're gated
-- on can_view_attendance — the same gate the attendance dashboard
-- already uses, which covers owner/admin/coach/staff by default and
-- is configurable per gym via gym_role_capabilities.

-- ============================================================================
-- count_members_as_of — snapshot member count at a given date
-- ============================================================================
-- A "member" is a gym_memberships row with role = 'member' that:
--   - existed on or before p_as_of (created_at <= p_as_of)
--   - was not left by p_as_of (left_at is null OR left_at > p_as_of)
-- Other roles (owner/admin/coach/staff) are excluded — staff aren't
-- the population we report on for "total members."

create or replace function public.count_members_as_of(
  p_gym_id uuid,
  p_as_of  date
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_view_attendance') then
    raise exception 'Not authorised';
  end if;
  return (
    select count(*)::int
      from public.gym_memberships
      where gym_id = p_gym_id
        and role = 'member'
        and created_at::date <= p_as_of
        and (left_at is null or left_at::date > p_as_of)
  );
end;
$$;

grant execute on function public.count_members_as_of(uuid, date) to authenticated;

-- ============================================================================
-- count_attendance_attendees — distinct members who attended at least
-- one class in the period
-- ============================================================================
-- Numerator of "attendance rate" — divide by count_members_as_of for
-- the same period_end to get the percentage. A member who attended
-- multiple classes is counted once.

create or replace function public.count_attendance_attendees(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_view_attendance') then
    raise exception 'Not authorised';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end before period start';
  end if;
  return (
    select count(distinct profile_id)::int
      from public.class_bookings
      where gym_id = p_gym_id
        and attended_at is not null
        and attended_at::date between p_period_start and p_period_end
  );
end;
$$;

grant execute on function public.count_attendance_attendees(uuid, date, date) to authenticated;
