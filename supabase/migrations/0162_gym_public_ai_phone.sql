-- Public data for the website builder's new "call" block (site-blocks.ts).
--
-- Same shape and same reasoning as gym_public_schedule/gym_public_plans
-- (0098): gym_agent_settings is RLS-gated to signed-in staff, so a
-- SECURITY DEFINER RPC is needed to read it from the unauthenticated
-- public site route — and it re-checks the site is actually published
-- for the same reason those do (SECURITY DEFINER bypasses RLS entirely,
-- so a gym that never published shouldn't have this become incidentally
-- anon-readable just because the function exists).
--
-- Deliberately returns nothing unless the front desk is fully live
-- (enabled, voice on, a number actually assigned) — a "call us" block
-- advertising a number that won't answer is worse than no block at all.

begin;

create function public.gym_public_ai_phone(p_slug text)
returns table (
  phone_number text
)
language sql
security definer
stable
set search_path = public
as $$
  select s.phone_number
  from public.gym_agent_settings s
  join public.gyms g on g.id = s.gym_id
  where g.slug = lower(p_slug)
    and s.enabled = true
    and s.voice_enabled = true
    and s.phone_number is not null
    and exists (
      select 1 from public.gym_websites w
      where w.gym_id = g.id and w.published = true
    );
$$;
grant execute on function public.gym_public_ai_phone(text) to anon, authenticated;

commit;
