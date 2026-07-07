-- Fix "column reference \"gym_id\" is ambiguous" when accepting an invite.
--
-- accept_invite's RETURNS TABLE (gym_id, role) declares OUT variables that
-- collide with the gym_memberships columns of the same name used in
-- INSERT ... ON CONFLICT (gym_id, profile_id) DO UPDATE SET role = ... .
-- plpgsql's default #variable_conflict is 'error', so it refused to resolve
-- the reference and raised. This was latent until the invite-accept flow was
-- exercised end to end (the deferred-invite resume now does). Prefer the
-- column for ambiguous references — the OUT columns are only ever populated
-- by the final, fully-qualified `return query`.
--
-- CREATE OR REPLACE (same signature + RETURNS shape) — no DROP needed.

create or replace function public.accept_invite(invite_code text)
returns table (gym_id uuid, role public.gym_role)
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

  insert into public.gym_memberships (gym_id, profile_id, role)
  values (v_invite.gym_id, v_profile, v_invite.role)
  on conflict (gym_id, profile_id) do update
    set role = excluded.role;

  update public.invite_codes
  set used_by = v_profile, used_at = now()
  where id = v_invite.id;

  return query select v_invite.gym_id, v_invite.role;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
