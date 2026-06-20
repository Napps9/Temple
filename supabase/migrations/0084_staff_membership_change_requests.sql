-- Staff queue for membership change requests.
--
-- RLS lets can_assign_plan staff SELECT the raw rows, but the queue needs
-- the member's name and the current/target plan names alongside each
-- request, and those joins cross tables whose RLS doesn't necessarily let
-- a coach read another member's row. This security-definer RPC does the
-- joins once, gated by the same user_can_assign_plan check, and returns
-- only the pending queue (oldest first — work it in order). Decisions are
-- applied by the stripe-modify-subscription edge function.

begin;

create or replace function public.staff_membership_change_requests(p_gym_id uuid)
returns table (
  id                   uuid,
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
