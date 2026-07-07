-- Unacknowledged staff_alerts (PAR-Q flags, injuries) never fed into
-- useNotificationCount — a coach could have open injury alerts sitting
-- in the Alerts tab with zero indication anywhere in the nav. Add a
-- count RPC so the nav badges can include them alongside the existing
-- DM/announcement/class-broadcast/check-in/log-nudge sources.

begin;

create function public.count_open_staff_alerts(
  p_gym_id uuid
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;
  return (
    select count(*)::int
    from public.staff_alerts
    where gym_id = p_gym_id
      and acknowledged_at is null
  );
end;
$$;

grant execute on function public.count_open_staff_alerts(uuid) to authenticated;

commit;
