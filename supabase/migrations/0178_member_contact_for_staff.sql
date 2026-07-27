-- Give the chase list somewhere to go.
--
-- gym_overdue_memberships returns a name and an amount and nothing else,
-- on purpose: contact details are governed by can_see_email /
-- can_see_full_pii, and routing them through a money RPC would sidestep
-- those gates (0174:255). The list deep-links to the member instead — and
-- the reasoning ended there, because the member profile screen renders no
-- email, no phone and no message action either. An owner reads "Sam Ali ·
-- £45 · card declined", taps the row expecting to contact them, and gets a
-- page of tags and injuries.
--
-- So: one RPC, per member, each field behind its own capability.
--
-- THIS IS THE FIRST PLACE can_see_email IS ENFORCED. Until now the key
-- existed in src/lib/can.ts, in every copy of the default_capability CASE,
-- and as a toggle in the team editor — and nothing anywhere read it. The
-- capability was a promise the app never kept.
--
-- What this does NOT fix, stated plainly so nobody mistakes the gate for a
-- guarantee: profiles.phone is already readable by every member of the same
-- gym through profiles_gym_member_select (0006:107), and the members CSV
-- export already emits it under can_export_members. The can_see_full_pii
-- check below gates THIS SURFACE, not the column. Closing that properly
-- means narrowing the profiles policy, which touches every screen that
-- reads a name, and is its own piece of work.

begin;

create or replace function public.gym_member_contact(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  email text,
  phone text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_email boolean := public.effective_can(p_gym_id, 'can_see_email');
  v_pii   boolean := public.effective_can(p_gym_id, 'can_see_full_pii');
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not authorised';
  end if;
  -- Distinguishable from "nothing on file" on purpose: a coach who cannot
  -- see contact details should be told that, not shown two blank rows.
  if not (v_email or v_pii) then
    raise exception 'Not authorised';
  end if;

  -- The target has to actually be at this gym. Without this, any staffer
  -- could read the email of any profile in the database by guessing a uuid.
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_profile_id
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  return query
  select
    case when v_email then u.email::text end,
    case when v_pii   then p.phone end
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_profile_id;
end;
$$;

grant execute on function public.gym_member_contact(uuid, uuid) to authenticated;

commit;
