-- Two things the roster could show but never change
--
-- The Team screen lists everyone and what they are, and Temple has never
-- had a write for either half of "and then somebody changed". Nothing
-- anywhere sets gym_memberships.role after an invite is accepted, so
-- "make Jo an admin" meant deleting Jo and re-inviting her, losing the
-- membership row and everything hanging off it. And taking somebody off
-- the team went through leave_gym, whose gate is user_can_admin — a raw
-- role check that reads the row without asking whether that person still
-- works here.
--
-- Both gaps are the same shape as the capability mismatches before them:
-- the screen offers a switch, the server asks a different question.
--
-- Three rules govern anything that touches a role, and they are
-- structural rather than capability-driven, because a capability is a
-- thing an owner can grant and these are the things that stop granting
-- one from being a mistake:
--
--   1. Only an owner mints an owner or an admin. Already true of
--      create_invite (0218). Now true of the role change too, which is
--      the other door into the same room.
--   2. Only an owner removes or demotes an owner or an admin. Otherwise
--      widening removal to a capability hands anyone holding it a way to
--      remove the person who granted it.
--   3. A gym always has at least one owner. The last one cannot demote
--      or remove themselves, because a gym whose owner has left is a gym
--      nobody can administer — there is no support console to fix it
--      from.

-- ---------------------------------------------------------------------------
-- 1. Somebody's role can change
-- ---------------------------------------------------------------------------
--
-- Demoting to 'member' is how "he's not coaching any more but he still
-- trains here" is said. It is not a removal and must not behave like
-- one: the membership row, the bookings, the history all stay.

create or replace function public.set_member_role(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_role       public.gym_role
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current  public.gym_role;
  v_is_owner boolean;
  v_owners   integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;

  select role into v_current
    from public.gym_memberships
    where gym_id = p_gym_id and profile_id = p_profile_id
      and left_at is null
    for update;
  if v_current is null then
    raise exception 'That person is not at this gym';
  end if;
  if v_current = p_role then
    return;
  end if;

  v_is_owner := public.user_is_owner_of(p_gym_id);
  if not v_is_owner and p_role in ('owner', 'admin') then
    raise exception 'Only owners can make someone an owner or an admin';
  end if;
  if not v_is_owner and v_current in ('owner', 'admin') then
    raise exception 'Only owners can change an owner or an admin';
  end if;

  -- The gym keeps an owner. Counted rather than assumed, because the
  -- caller may be one of several.
  if v_current = 'owner' then
    select count(*) into v_owners
      from public.gym_memberships
      where gym_id = p_gym_id and role = 'owner' and left_at is null;
    if v_owners <= 1 then
      raise exception 'A gym needs an owner — make someone else an owner first';
    end if;
  end if;

  update public.gym_memberships
    set role = p_role
    where gym_id = p_gym_id and profile_id = p_profile_id
      and left_at is null;

  -- Per-person capability overrides were granted against the job they
  -- had. Carrying them into a new role is how a demoted admin keeps
  -- admin powers under a coach's label, which is worse than either.
  delete from public.gym_member_capabilities
    where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid, public.gym_role)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Taking somebody off the roster asks the right question
-- ---------------------------------------------------------------------------
--
-- 0176's function, restated with its authorisation block replaced.
-- Everything it does once past the gate is unchanged — this is the path
-- the member's own Leave button, the staff Remove dialog and the health
-- erasure all go through.
--
-- The old gate was user_can_admin: role in ('owner','admin'), no left_at
-- guard, so an admin who left in March could still remove members in
-- July. The screen has always gated its button on can_archive_members,
-- which an owner can grant to a coach; the server refused, so the switch
-- showed somebody a button that failed. Same bug as 0218's, on a more
-- destructive verb.

create or replace function public.leave_gym(p_gym_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.gym_role;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_profile_id then
    if not public.effective_can(p_gym_id, 'can_archive_members') then
      raise exception 'Not authorised';
    end if;
    -- The ladder, same shape as create_invite's: an owner or an admin can
    -- only be taken off the roster by an owner. Without it, widening the
    -- gate to a capability would hand anyone holding "Remove members" a
    -- way to remove the person who granted it.
    select role into v_role
      from public.gym_memberships
      where gym_id = p_gym_id and profile_id = p_profile_id
        and left_at is null;
    if v_role in ('owner', 'admin')
       and not public.user_is_owner_of(p_gym_id) then
      raise exception 'Only owners can remove owners or admins';
    end if;
  end if;

  -- A gym whose only owner has walked out cannot be administered by
  -- anyone, including them.
  if exists (
    select 1 from public.gym_memberships
      where gym_id = p_gym_id and profile_id = p_profile_id
        and role = 'owner' and left_at is null
  ) and (
    select count(*) from public.gym_memberships
      where gym_id = p_gym_id and role = 'owner' and left_at is null
  ) <= 1 then
    raise exception 'A gym needs an owner — make someone else an owner first';
  end if;

  update public.gym_memberships
    set left_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;

  delete from public.class_bookings
    where profile_id = p_profile_id
      and class_session_id in (
        select id from public.class_sessions
        where gym_id = p_gym_id and starts_at > now()
      );

  update public.plan_subscriptions
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and not public.is_terminal_subscription_status(status);

  update public.comp_grants
    set revoked_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and revoked_at is null;

  delete from public.class_waitlist
    where gym_id = p_gym_id and profile_id = p_profile_id;

  delete from public.membership_invoice_links
    where gym_id = p_gym_id and profile_id = p_profile_id;
  delete from public.plan_subscription_dunning
    where gym_id = p_gym_id and profile_id = p_profile_id;
  delete from public.payment_notifications
    where gym_id = p_gym_id and recipient_profile_id = p_profile_id;

  -- Removal from the membership erases the member's special-category
  -- health data immediately (the "OR after member is removed" half of
  -- the retention rule). Re-joining means re-consenting + re-screening.
  perform public._erase_member_health_data(p_gym_id, p_profile_id, 'erase');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Leaving stops meaning admin
-- ---------------------------------------------------------------------------
--
-- user_can_admin backs thirteen policies across eight tables and reads
-- the membership row without asking whether the person still works here.
-- effective_can has required left_at is null since it was written; this
-- is the last raw-role holdout, and it is the one the destructive verbs
-- lean on. Strictly tightening: nothing legitimate depends on a departed
-- admin keeping their keys.

create or replace function public.user_can_admin(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'admin')
  );
$$;
