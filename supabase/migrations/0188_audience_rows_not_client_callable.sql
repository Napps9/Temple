-- Any authenticated user can read every member's name and email, from any
-- gym, whether or not they belong to it.
--
--   select * from comms_audience_rows(
--     '<any gym uuid>', '{"kind":"all_members"}'::jsonb, null);
--
-- Reproduced against a local build of this schema: a user belonging to no
-- gym at all got back the member's address. comms_audience_rows is
-- `security definer` and joins auth.users for the email, so RLS does not
-- apply and the gym id is simply whatever the caller passed.
--
-- 0044 knew this. It created the function as definer-internal plumbing and
-- revoked it from public (0044:460), granting only comms_audience_sample —
-- the same (profile_id, full_name, email) shape, but wrapped in
-- `effective_can(p_gym_id, 'can_manage_comms')`. 0058 rewrote the pair to
-- take a topic id, carried the `revoke ... from public` forward verbatim,
-- and then granted the function to `authenticated` two lines later
-- (0058:204, and again at :245 for the two-arg shim). `create or replace`
-- preserves the ACL, so 0059, 0182 and every later redefinition kept it.
--
-- comms_audience_count lost its guard in the same rewrite for a different
-- reason: 0044:463 was `language plpgsql` and opened with the
-- effective_can check; 0058:190 reimplemented it as `language sql`, and
-- the guard went with the begin/end block. Granted to authenticated at
-- 0058:203. That one is an oracle rather than a dump —
-- {"kind":"manual","profile_ids":["<uuid>"]} returns 1 or 0, which tests
-- whether a named person belongs to a named gym.
--
-- This is the one hole in a line this codebase otherwise holds carefully:
-- can_see_email and can_see_full_pii are separate admin-only capabilities
-- (0178), and 0176 deliberately keeps a member's address off
-- payment_notifications so that can_see_money staff cannot read it.
--
-- Nothing in the app calls comms_audience_rows — the only client caller in
-- the pair is comms_audience_count (src/lib/comms.ts:206), which passes
-- the caller's own gym. So revoking costs nothing.

begin;

revoke execute on function public.comms_audience_rows(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke execute on function public.comms_audience_rows(uuid, jsonb)
  from public, anon, authenticated;

-- Back to 0044's shape: plpgsql so there is somewhere to put the guard.
create or replace function public.comms_audience_count(
  p_gym_id     uuid,
  p_definition jsonb,
  p_topic_id   uuid
) returns integer
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.effective_can(p_gym_id, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  select count(*)::int into v_count
    from public.comms_audience_rows(p_gym_id, p_definition, p_topic_id);
  return v_count;
end;
$$;

grant execute on function public.comms_audience_count(uuid, jsonb, uuid)
  to authenticated;

create or replace function public.comms_audience_count(
  p_gym_id     uuid,
  p_definition jsonb
) returns integer
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return public.comms_audience_count(p_gym_id, p_definition, null);
end;
$$;

grant execute on function public.comms_audience_count(uuid, jsonb)
  to authenticated;

commit;
