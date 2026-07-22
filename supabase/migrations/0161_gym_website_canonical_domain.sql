-- Site builder — canonical domain lookup for the public renderer.
--
-- api/site/[...path].ts needs to know, for a given gym slug, whether a
-- verified custom domain is connected so it can emit the right
-- <link rel="canonical"> — today the platform path (/site/<slug>) stays
-- live and indexable even after a custom domain connects (middleware.ts
-- only rewrites that domain's bare root), which is real duplicate-content
-- exposure with nothing telling a crawler which URL is authoritative.
--
-- gym_website_domains has no anon-readable policy at all (RLS requires
-- can_manage_website — see 0099), so the public route can't just query the
-- table directly the way the staff editor does. This is the slug -> domain
-- mirror of gym_slug_for_domain (0099's domain -> slug lookup for
-- middleware.ts): same anon-safe shape, same "only ever a verified domain"
-- guarantee, plus its own published check so an unpublished site's domain
-- (if any) never leaks through this path either.

begin;

create function public.gym_website_canonical_domain(p_slug text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select d.domain
  from public.gym_website_domains d
  join public.gyms g on g.id = d.gym_id
  join public.gym_websites w on w.gym_id = g.id
  where g.slug = lower(p_slug)
    and d.status = 'verified'
    and w.published = true
  limit 1;
$$;
grant execute on function public.gym_website_canonical_domain(text) to anon, authenticated;

commit;
