-- 0239: The invite that let nobody back in
--
-- Found by sweeping the definer functions that touch gym_memberships
-- without mentioning left_at, the same way 0236 was found by sweeping the
-- role helpers. Three hits, one of them user-visible and expensive.
--
-- ACCEPT_INVITE NEVER CLEARS left_at.
--
-- leave_gym closes a membership by stamping left_at, keeping the row.
-- accept_invite upserts on (gym_id, profile_id) and sets only the role,
-- so a member who left and was then invited back gets: the code marked
-- used, the role updated, and left_at still set. Verified — after the
-- accept, user_belongs_to returns false. They are told they joined and
-- they did not, and because an invite is single-use the code cannot be
-- tried again. The gym has to notice and issue another one.
--
-- 0033 designed for exactly this case ("re-joining the gym you previously
-- left stays allowed") and wrote it into join_gym_by_slug, which does
-- `do update set left_at = null`. accept_invite was not in that change.
--
-- The other half of 0033 was missed here too: create_gym and
-- join_gym_by_slug both refuse when the caller already holds an active
-- membership somewhere else, because the client routes to a single gym.
-- An invite could still mint a second one, and then "oldest active
-- membership wins" (src/lib/auth.ts) lands the invited person in the gym
-- they were already in, not the one that invited them. Same rule, same
-- message, and the raise rolls back before the code is consumed, so a
-- refused invite stays usable once they have left the other gym.
--
-- SET_MEMBER_BOOKING_REQUIREMENT AUTHORISES ON ROLE ALONE.
--
-- 0236's bug, written inline rather than through a helper, which is why
-- the helper sweep did not catch it: `role in ('owner','admin')` against
-- gym_memberships with no left_at guard. An owner or admin who left can
-- still decide whether any member of that gym needs a membership to book.
--
-- GYM_ROLE_CAPABILITIES_SELF_SELECT DOES THE SAME.
--
-- A departed member keeps reading the gym's capability matrix for their
-- old role — what every role in that gym is allowed to do. No member data
-- and no write, but it is the same missing line and the app never asks for
-- it once the membership is closed.
--
-- Not changed, checked and left alone: set_appear_in_leaderboards lets a
-- departed member flip their own flag on the gym they left, and both
-- leaderboards already filter left_at is null, so the write is inert.

begin;

create or replace function public.accept_invite(invite_code text)
returns table(gym_id uuid, role gym_role)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_invite public.invite_codes;
  v_profile uuid;
begin
  v_profile := auth.uid();
  if v_profile is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite from public.invite_codes where code = invite_code;
  if v_invite is null then
    raise exception 'Invite code not found';
  end if;
  if v_invite.used_at is not null then
    raise exception 'Invite code already used';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite code expired';
  end if;

  if exists (
    select 1 from public.gym_memberships gm
    where gm.profile_id = v_profile
      and gm.left_at is null
      and gm.gym_id <> v_invite.gym_id
  ) then
    raise exception 'You already belong to a gym — one gym per account for now';
  end if;

  insert into public.gym_memberships (gym_id, profile_id, role)
  values (v_invite.gym_id, v_profile, v_invite.role)
  on conflict (gym_id, profile_id) do update
    set role = excluded.role,
        left_at = null;

  update public.invite_codes
  set used_by = v_profile, used_at = now()
  where id = v_invite.id;

  return query select v_invite.gym_id, v_invite.role;
end;
$$;

create or replace function public.set_member_booking_requirement(
  p_gym_id uuid, p_profile_id uuid, p_value boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = auth.uid()
      and role in ('owner', 'admin')
      and left_at is null
  ) then
    raise exception 'Only an owner or admin can change this';
  end if;
  update public.gym_memberships
    set require_membership_to_book = p_value
    where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;

drop policy if exists gym_role_capabilities_self_select
  on public.gym_role_capabilities;
create policy gym_role_capabilities_self_select
  on public.gym_role_capabilities
  for select using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = gym_role_capabilities.gym_id
        and gm.profile_id = auth.uid()
        and gm.role = gym_role_capabilities.role
        and gm.left_at is null
    )
  );

commit;
