-- Site builder — Team block public data.
--
-- The new Team block (site-blocks.ts) renders the gym's real staff
-- roster at render time, not stored content — same "live-computed,
-- owner hides individual rows via hiddenMemberIds" shape as Pricing.
-- gym_memberships/profiles have no public/anon read path (RLS-gated
-- to signed-in gym members), so this adds one more SECURITY DEFINER
-- RPC, same shape and same published-recheck discipline as
-- gym_public_schedule/gym_public_plans (0098): SECURITY DEFINER
-- bypasses the base tables' RLS entirely, so a gym that never
-- published a site must not have its staff roster become incidentally
-- anon-readable just because this function exists.
--
-- Role scope matches the existing staff-roster query precedent
-- (management's TeamTab): owner/admin/coach/staff, excluding anyone
-- who has left (left_at is not null) — never plain members.

begin;

create function public.gym_public_team(p_slug text)
returns table (
  profile_id uuid,
  full_name  text,
  avatar_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select gm.profile_id, p.full_name, p.avatar_url
  from public.gym_memberships gm
  join public.gyms g on g.id = gm.gym_id
  join public.profiles p on p.id = gm.profile_id
  where g.slug = lower(p_slug)
    and gm.role in ('owner', 'admin', 'coach', 'staff')
    and gm.left_at is null
    and exists (
      select 1 from public.gym_websites w
      where w.gym_id = g.id and w.published = true
    )
  order by
    case gm.role
      when 'owner' then 0
      when 'admin' then 1
      when 'coach' then 2
      else 3
    end,
    p.full_name nulls last;
$$;
grant execute on function public.gym_public_team(text) to anon, authenticated;

commit;
