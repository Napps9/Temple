-- "Send invites" now sends invites
--
-- Two switches sit next to each other on the Team screen:
--
--   can_invite       "Email invites to new members and staff."
--   can_manage_staff  the team, roles and permissions.
--
-- The invite box on the Members screen shows itself on can_invite.
-- create_invite asked for can_manage_staff. Both default to owner and
-- admin, so nothing looked wrong — until an owner turned "Send invites"
-- on for coaches, which is the only situation the switch exists for. Then
-- the coach saw the box, typed an address, and the database refused. The
-- switch's entire effect was to show somebody a button that failed.
--
-- The gate is now can_invite, which is what the screen reads and what the
-- label promises. This WIDENS access, unlike the four capability fixes
-- before it, so it was the owner's call rather than a reading of a label,
-- and the owner made it: someone granted "Send invites" can invite
-- members and staff.
--
-- What does not move is the ladder. Minting an owner or an admin stays
-- owner-only, structurally, regardless of any capability — otherwise
-- granting a coach "Send invites" would be granting them a route to
-- making themselves an admin. That check is unchanged and now matters
-- more, not less: it is the only thing standing between the widened gate
-- and privilege escalation.
--
-- can_manage_staff keeps everything else it governs — pending_members,
-- the roster, role and permission editing.

create or replace function public.create_invite(
  p_gym_id     uuid,
  p_role       public.gym_role,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text;
  v_is_owner  boolean;
begin
  if not public.effective_can(p_gym_id, 'can_invite') then
    raise exception 'Not authorised';
  end if;
  v_is_owner := public.user_is_owner_of(p_gym_id);
  -- Owner-only ladder for minting higher-privilege roles. Structural,
  -- not overridable: nobody but an owner mints an admin or an owner,
  -- whatever capabilities they hold. With can_invite as the gate above,
  -- this is what stops "let the coaches send invites" becoming "let the
  -- coaches make themselves admins".
  if not v_is_owner and p_role in ('owner', 'admin') then
    raise exception 'Only owners can invite owners or admins';
  end if;
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.invite_codes (gym_id, code, role, created_by, expires_at)
    values (p_gym_id, v_code, p_role, auth.uid(), p_expires_at);
  return v_code;
end;
$$;
