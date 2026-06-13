-- Per-gym sending domain authentication (the Mailchimp "domain
-- authentication" tier). A gym connects a domain they own, adds the
-- DKIM / SPF / DMARC DNS records we hand them, and once verified their
-- campaigns send from their own address (DKIM-aligned, DMARC-passing,
-- no "via" annotation) instead of the shared platform domain.
--
-- One domain per gym. The row is owned end-to-end by the `sending-domain`
-- edge function (service role) talking to Resend's Management API:
-- `connect` registers the domain and stores the records Resend returns,
-- `verify` re-reads status, `disconnect` removes it. Staff with
-- can_manage_comms can READ the row (to render the records + status), but
-- there are deliberately NO client write policies — the Resend-managed
-- fields (id, status, records) must never be settable from the client.
-- `from_local` is the only user-chosen field and is set through the same
-- function.
--
-- The send path (send-campaign) reads this table: status = 'verified'
-- means send from `<from_local>@<domain>`, otherwise it falls back to the
-- shared RESEND_FROM_EMAIL exactly as before.

begin;

create table public.gym_sending_domains (
  gym_id            uuid primary key references public.gyms(id) on delete cascade,
  domain            text not null check (length(trim(domain)) > 0),
  -- Local part of the From address, e.g. 'news' -> news@mail.gym.com.
  from_local        text not null default 'news'
                      check (from_local ~ '^[a-z0-9._-]{1,64}$'),
  -- Resend's domain id; null only in the brief window before the first
  -- successful create call persists.
  resend_domain_id  text,
  status            text not null default 'pending'
                      check (status in ('pending', 'verified', 'failed', 'temporary_failure')),
  -- The DNS records Resend returned for the gym to add, rendered as-is by
  -- the settings UI so we're robust to Resend's exact field shape.
  records           jsonb not null default '[]'::jsonb,
  last_checked_at   timestamptz,
  verified_at       timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.gym_sending_domains enable row level security;

-- Read-only to staff who manage comms. Every write happens in the
-- sending-domain edge function under the service role, so there is no
-- insert / update / delete policy here on purpose.
create policy gym_sending_domains_select on public.gym_sending_domains
  for select using (public.effective_can(gym_id, 'can_manage_comms'));

commit;
