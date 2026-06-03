-- Phase 1 cross-cutting: profile erasure helper.
--
-- GDPR right-to-erasure. We anonymise PII but keep profiles.id as
-- a tombstone so foreign keys in billing_events, audit_events, etc.
-- remain valid — financial records are retained ~6 years under UK
-- statutory rules and need a resolvable subject.
--
-- Sprint 5 scope: full_name, avatar_url, phone are cleared on
-- profiles; chat_messages bodies authored by the erased profile are
-- replaced with a placeholder; workout_logs.notes are nulled. Logs
-- and audit_events themselves are retained — the rows stay, the
-- identifying free text doesn't.
--
-- Caller authorisation: the profile itself (self-erasure) or a
-- gym owner where the profile is a member (operator-driven
-- exits / migrations).

create or replace function public.erase_profile(
  p_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  if v_actor <> p_profile_id then
    select exists (
      select 1
      from public.gym_memberships gm
      where gm.profile_id = p_profile_id
        and public.user_is_owner_of(gm.gym_id)
    ) into v_is_owner;
    if not v_is_owner then
      raise exception 'Not authorised to erase this profile';
    end if;
  end if;

  update public.profiles
  set full_name  = null,
      avatar_url = null,
      phone      = null
  where id = p_profile_id;

  update public.chat_messages
  set body = '(erased)'
  where sender_profile_id = p_profile_id;

  update public.workout_logs
  set notes = null
  where profile_id = p_profile_id;

  -- Audit the erasure itself with no PII in the payload.
  insert into public.audit_events (
    actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_actor, 'member', p_profile_id, 'profile_erased',
    jsonb_build_object('self_initiated', v_actor = p_profile_id)
  );
end;
$$;

grant execute on function public.erase_profile(uuid) to authenticated;
