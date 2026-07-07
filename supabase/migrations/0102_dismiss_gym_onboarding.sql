-- Persist "Skip for now" on the onboarding checklist.
--
-- Today Skip only writes a web sessionStorage flag (src/app/onboarding.tsx),
-- so it doesn't survive a new browser session and never applies on native
-- at all -- an owner who skips gets redirected straight back to /onboarding
-- next time they open the app. Give gyms a durable, cross-device way to
-- stop seeing the checklist: a timestamp column plus a security-definer
-- RPC to set it, checked by the root redirect gate alongside the existing
-- required-steps-done check.

begin;

alter table public.gyms
  add column if not exists onboarding_dismissed_at timestamptz;

create or replace function public.dismiss_gym_onboarding(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can dismiss onboarding';
  end if;
  update public.gyms
    set onboarding_dismissed_at = now()
    where id = p_gym_id;
end;
$$;

grant execute on function public.dismiss_gym_onboarding(uuid) to authenticated;

commit;
