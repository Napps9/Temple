-- Public marketing demo credentials — backs the "Launch your gym" section
-- on the marketing site, which iframes a real, live demo tenant
-- (demo-launchpad, see docs/demo-gym.md) and offers sign-in CTAs into it.
--
-- Base table stays locked down (RLS enabled, zero policies — service-role
-- writes only, same posture as gym_sending_domains). A single
-- SECURITY DEFINER RPC, same shape as gym_website_by_slug (0098), exposes
-- only the current row. It takes NO parameters — that's deliberate: there
-- is no slug/id a caller could pass to fish for a different tenant's data,
-- which is the main abuse-resistance property here, more than any rate
-- limit could be.

begin;

create table public.demo_marketing_credentials (
  slug             text primary key,
  gym_name         text not null,
  owner_email      text not null,
  owner_password   text not null,
  member_email     text not null,
  member_password  text not null,
  rotated_at       timestamptz not null default now()
);
alter table public.demo_marketing_credentials enable row level security;
-- No policies — nothing reads or writes the base table directly except
-- the service role (the nightly rotation job) and this file's RPC.

create function public.demo_marketing_credentials()
returns table (
  slug            text,
  gym_name        text,
  owner_email     text,
  owner_password  text,
  member_email    text,
  member_password text,
  rotated_at      timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select slug, gym_name, owner_email, owner_password,
         member_email, member_password, rotated_at
  from public.demo_marketing_credentials
  order by rotated_at desc
  limit 1;
$$;
grant execute on function public.demo_marketing_credentials() to anon, authenticated;

commit;
