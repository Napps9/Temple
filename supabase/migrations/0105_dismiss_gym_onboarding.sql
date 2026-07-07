-- "Skip for now" on /onboarding only wrote a sessionStorage flag, so
-- the redirect gate in src/app/index.tsx sent an owner straight back
-- to the full-screen onboarding checklist on their very next sign-in —
-- not what "skip" should mean. Give the dismissal a permanent home on
-- the gym row instead, mirroring operating_defaults_reviewed_at
-- (0070): a nullable timestamp stamped by an owner-only RPC. gyms is
-- already member-readable (gyms_member_select, 0001/0002), so the
-- client can read the flag directly with no new read-side RPC.

begin;

alter table public.gyms
  add column onboarding_dismissed_at timestamptz;

create function public.dismiss_gym_onboarding(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can dismiss onboarding';
  end if;
  update public.gyms set onboarding_dismissed_at = now() where id = p_gym_id;
end;
$$;

grant execute on function public.dismiss_gym_onboarding(uuid) to authenticated;

commit;
