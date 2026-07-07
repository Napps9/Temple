-- Site builder — Phase B: custom domains.
--
-- Lets a gym connect a domain they own so their published site serves
-- directly from it instead of only <platform>/site/<slug>.
--
-- gym_websites already grew speculative custom_domain/domain_verified_at
-- columns in 0097, but that table's update policy has no column-level
-- restriction — any staff member with can_manage_website could UPDATE
-- those two columns directly through the client and fake a verified
-- domain. gym_sending_domains (0048) avoids exactly this problem for
-- Resend-managed state by giving it its own table with NO client write
-- policy at all; every write happens in an edge function under the
-- service role. This migration drops the two unsafe columns and gives
-- custom domains the same treatment.
--
-- The Vercel-facing connect/verify/disconnect actions live in the
-- custom-domain edge function (mirrors sending-domain/index.ts). This
-- migration only lays down the table, RLS, and the public lookup RPC
-- the Host-header routing middleware (middleware.ts) calls to resolve a
-- verified custom domain to a gym slug.

begin;

alter table public.gym_websites
  drop column if exists custom_domain,
  drop column if exists domain_verified_at;

create table public.gym_website_domains (
  gym_id           uuid primary key references public.gyms(id) on delete cascade,
  domain           text not null check (domain = lower(domain) and length(trim(domain)) > 0),
  status           text not null default 'pending'
                     check (status in ('pending', 'verified', 'error')),
  -- The DNS records Vercel returns, rendered as-is by the UI so we're
  -- robust to Vercel's exact field shape — same reasoning as
  -- gym_sending_domains.records (0048).
  records          jsonb not null default '[]'::jsonb,
  error_message    text,
  last_checked_at  timestamptz,
  verified_at      timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One gym per domain — the actual guard against two gyms fighting over
-- the same domain, enforced at the DB layer rather than only in the
-- edge function.
create unique index gym_website_domains_domain_key on public.gym_website_domains (domain);

alter table public.gym_website_domains enable row level security;

-- Read-only to staff who manage the site. Every write happens in the
-- custom-domain edge function under the service role, so there is no
-- insert / update / delete policy here on purpose — mirrors
-- gym_sending_domains (0048).
create policy gym_website_domains_select on public.gym_website_domains
  for select using (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  );

-- Host -> slug resolution for middleware.ts. Deliberately minimal: only
-- ever returns a slug for a domain that has actually verified DNS
-- ownership. The `published` gate stays solely in gym_website_by_slug
-- (0098), which the resolved slug is then rendered through — this RPC
-- doesn't duplicate that check.
create function public.gym_slug_for_domain(p_host text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select g.slug
  from public.gym_website_domains d
  join public.gyms g on g.id = d.gym_id
  where d.domain = lower(trim(p_host))
    and d.status = 'verified'
  limit 1;
$$;
grant execute on function public.gym_slug_for_domain(text) to anon, authenticated;

commit;
