-- Add profile_id to the staff membership-change queue RPC.
--
-- The Members list now marks which members have a pending change request and
-- lets staff approve/reject it inline, so the queue has to say which member
-- each request belongs to. That changes the RETURNS shape, and a plain
-- CREATE OR REPLACE can't add a column to a function's return table (this
-- bit us in 0043) — DROP first, then recreate.

begin;

drop function if exists public.staff_membership_change_requests(uuid);

create function public.staff_membership_change_requests(p_gym_id uuid)
returns table (
  id                   uuid,
  profile_id           uuid,
  plan_subscription_id uuid,
  kind                 public.membership_change_kind,
  member_note          text,
  created_at           timestamptz,
  member_name          text,
  current_plan_name    text,
  target_plan_name     text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not allowed';
  end if;
  return query
    select
      r.id,
      r.profile_id,
      r.plan_subscription_id,
      r.kind,
      r.member_note,
      r.created_at,
      p.full_name,
      cp.name,
      tp.name
    from public.membership_change_requests r
    join public.profiles p on p.id = r.profile_id
    left join public.plan_subscriptions ps on ps.id = r.plan_subscription_id
    left join public.membership_plans cp on cp.plan_id = ps.plan_id
    left join public.membership_plans tp on tp.plan_id = r.target_plan_id
    where r.gym_id = p_gym_id
      and r.status = 'pending'
    order by r.created_at asc;
end;
$$;

grant execute on function public.staff_membership_change_requests(uuid) to authenticated;

commit;
