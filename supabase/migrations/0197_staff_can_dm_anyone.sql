-- can_dm blocked staff from DMing members, contradicting the setting it
-- implements.
--
-- The member-coach-only DM scope is described in the app as: "Members can
-- DM coaches, admins, and the owner. Member to member DMs are blocked.
-- Staff can still DM anyone." can_dm (0029) implemented the first two
-- sentences and not the third: its allow-branch was
-- `sender_role in ('owner','admin','coach')`, which omits staff, so a
-- staff-role sender fell through to the member rule and could only reach
-- owner/admin/coach — not the members they exist to talk to. The
-- function's own comment claimed staff could DM anyone; the code did not.
--
-- The scope's governing rule is the middle sentence — member-to-member is
-- the thing being blocked — so that is what this encodes: a DM is allowed
-- unless BOTH ends are members. That makes "staff can DM anyone" true and,
-- unlike adding staff only to the sender side, keeps threads two-way: a
-- member can reply to the staff member who messaged them, rather than
-- receiving a DM they are forbidden to answer.
--
-- Signature unchanged, so CREATE OR REPLACE (no arity/return change).

begin;

create or replace function public.can_dm(p_gym_id uuid, p_sender uuid, p_recipient uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope          text;
  v_sender_role    public.gym_role;
  v_recipient_role public.gym_role;
begin
  if p_sender = p_recipient then return false; end if;
  select g.dm_scope into v_scope from public.gyms g where g.id = p_gym_id;
  if v_scope is null then return false; end if;

  select gm.role into v_sender_role
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_sender
      and gm.left_at is null;
  select gm.role into v_recipient_role
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_recipient
      and gm.left_at is null;
  if v_sender_role is null or v_recipient_role is null then return false; end if;

  if v_scope = 'full_gym' then return true; end if;
  -- member_coach_only: the only pairing blocked is member-to-member.
  -- Everyone on the staff side (owner/admin/coach/staff) can reach anyone,
  -- and a member can reach — and reply to — anyone who is not a member.
  return v_sender_role <> 'member' or v_recipient_role <> 'member';
end;
$$;

commit;
