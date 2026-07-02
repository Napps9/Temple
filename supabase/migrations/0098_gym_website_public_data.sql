-- Site builder — public schedule + pricing data.
--
-- The schedule and pricing blocks (0097) render real class_sessions and
-- membership_plans rows, not stored content — but neither table has a
-- public/anon read path (both are RLS-gated to signed-in members of the
-- gym). Two new SECURITY DEFINER RPCs, same shape as gym_website_by_slug:
-- both explicitly re-check the site is actually published before
-- returning anything, since SECURITY DEFINER bypasses the base tables'
-- RLS entirely — a gym that never opted into a public site shouldn't
-- have its schedule or pricing become incidentally anon-readable just
-- because these functions now exist.
--
-- gym_public_schedule returns the next 7 days of sessions — enough for
-- a "this week" marketing view, not a full booking surface (booking
-- itself still requires signing in, same as today).

begin;

create function public.gym_public_schedule(p_slug text)
returns table (
  session_id        uuid,
  starts_at         timestamptz,
  duration_minutes  int,
  class_type_name   text,
  class_type_color  text,
  coach_name        text
)
language sql
security definer
stable
set search_path = public
as $$
  select cs.id, cs.starts_at, cs.duration_minutes,
         ct.name, ct.color,
         p.full_name
  from public.class_sessions cs
  join public.gyms g on g.id = cs.gym_id
  left join public.class_types ct on ct.id = cs.class_type_id
  left join public.profiles p on p.id = cs.coach_id
  where g.slug = lower(p_slug)
    and exists (
      select 1 from public.gym_websites w
      where w.gym_id = g.id and w.published = true
    )
    and cs.starts_at >= date_trunc('day', now())
    and cs.starts_at < now() + interval '7 days'
  order by cs.starts_at
  limit 50;
$$;
grant execute on function public.gym_public_schedule(text) to anon, authenticated;

create function public.gym_public_plans(p_slug text)
returns table (
  plan_id             uuid,
  name                text,
  kind                text,
  credit_count        int,
  monthly_price_cents int
)
language sql
security definer
stable
set search_path = public
as $$
  select mp.plan_id, mp.name, mp.kind, mp.credit_count, mp.monthly_price_cents
  from public.membership_plans mp
  join public.gyms g on g.id = mp.gym_id
  where g.slug = lower(p_slug)
    and mp.archived_at is null
    and exists (
      select 1 from public.gym_websites w
      where w.gym_id = g.id and w.published = true
    )
  order by mp.monthly_price_cents nulls last;
$$;
grant execute on function public.gym_public_plans(text) to anon, authenticated;

-- ============================================================================
-- gym_website_by_slug grows gym_currency, so the pricing block's
-- formatMoney call doesn't need a second round trip just for this one
-- field. RETURNS shape changed — DROP first, CREATE OR REPLACE won't
-- do it (bit us once already, see 0043).
-- ============================================================================

drop function if exists public.gym_website_by_slug(text);

create function public.gym_website_by_slug(p_slug text)
returns table (
  gym_id             uuid,
  gym_name           text,
  gym_logo_url       text,
  gym_primary_color  text,
  gym_currency       text,
  theme              text,
  design             jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select w.gym_id, g.name, g.logo_url, g.primary_color, g.currency, w.theme, w.design
  from public.gym_websites w
  join public.gyms g on g.id = w.gym_id
  where g.slug = lower(p_slug)
    and w.published = true;
$$;
grant execute on function public.gym_website_by_slug(text) to anon, authenticated;

commit;
