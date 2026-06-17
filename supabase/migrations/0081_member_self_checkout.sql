-- Member self-serve checkout toggle. When on (the default), members can
-- pick a plan and pay via Stripe Checkout themselves; when off, only
-- staff can charge a member. Owner-only RPC to flip it.

begin;

alter table public.gyms
  add column if not exists members_can_self_checkout boolean not null default true;

create or replace function public.set_member_self_checkout(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change billing settings';
  end if;
  update public.gyms
    set members_can_self_checkout = p_enabled
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_member_self_checkout(uuid, boolean) to authenticated;

commit;
