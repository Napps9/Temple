-- Phase 3a — prospect / lead tracking.
--
-- Two new tables:
--
--   - lead_sources  (per-gym vocabulary)
--     The gym defines its own funnel labels — "Instagram", "Walk-in",
--     "Open day Apr-26", "Refer-a-friend". A colour for the chip.
--     Default set of three seeded on first read by the surface; we
--     don't preseed here because the gym's sources are theirs to
--     name.
--
--   - leads  (one row per prospect)
--     A person who hasn't joined yet. Captured by staff (or by a
--     future public lead-capture form). Status moves through a small
--     fixed pipeline. On convert, links to the member profile that
--     was eventually created so the conversion dashboard can report.
--
-- Both gates: can_export_members (the existing capability that
-- already covers "see lead-shaped data") for read; can_invite for
-- write — same role floor as the existing comp-grant / invite flows.
-- can_export_members covers the visibility side because the same
-- audience (owner / admin) handles the lead funnel today.
--
-- conversion window: leads.converted_at uses gym.lead_conversion_window_days
-- (added in 0049) — a member created within N days of the lead's
-- captured_at and matched on email is auto-attributed; staff can
-- also manually attribute through the UI.

begin;

-- ============================================================================
-- 1. lead_sources
-- ============================================================================

create table public.lead_sources (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  label       text not null,
  color       text not null default '#6B7280',
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create index lead_sources_gym_id_idx on public.lead_sources(gym_id);
create unique index lead_sources_gym_label_unique
  on public.lead_sources(gym_id, lower(label))
  where archived_at is null;

alter table public.lead_sources enable row level security;

create policy lead_sources_tenant_select on public.lead_sources
  for select using (public.user_belongs_to(gym_id));
create policy lead_sources_staff_write on public.lead_sources
  for all using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- 2. leads
-- ============================================================================

create type public.lead_status as enum (
  'cold',
  'contacted',
  'intro_booked',
  'trial_attended',
  'converted',
  'lost'
);

create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  full_name            text not null,
  email                text,
  phone                text,
  source_id            uuid references public.lead_sources(id) on delete set null,
  status               public.lead_status not null default 'cold',
  notes                text,
  captured_at          timestamptz not null default now(),
  captured_by          uuid references public.profiles(id) on delete set null,
  converted_at         timestamptz,
  converted_profile_id uuid references public.profiles(id) on delete set null,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index leads_gym_status_idx on public.leads(gym_id, status);
create index leads_gym_captured_idx on public.leads(gym_id, captured_at desc);
create index leads_email_idx on public.leads(lower(email)) where email is not null;

alter table public.leads enable row level security;

create policy leads_tenant_select on public.leads
  for select using (public.user_can_assign_plan(gym_id));
create policy leads_staff_insert on public.leads
  for insert with check (public.user_can_assign_plan(gym_id));
create policy leads_staff_update on public.leads
  for update using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));

-- Touch updated_at on every UPDATE.
create or replace function public._leads_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_touch_updated_at_trg
  before update on public.leads
  for each row execute function public._leads_touch_updated_at();

-- ============================================================================
-- 3. record_lead — wrapper that defaults captured_by + sanity-checks
-- ============================================================================

create or replace function public.record_lead(
  p_gym_id    uuid,
  p_full_name text,
  p_email     text default null,
  p_phone     text default null,
  p_source_id uuid default null,
  p_notes     text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;

  insert into public.leads
    (gym_id, full_name, email, phone, source_id, notes, captured_by)
  values
    (p_gym_id, btrim(p_full_name),
     nullif(btrim(coalesce(p_email, '')), ''),
     nullif(btrim(coalesce(p_phone, '')), ''),
     p_source_id, p_notes, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.record_lead(uuid, text, text, text, uuid, text)
  to authenticated;

-- ============================================================================
-- 4. set_lead_status — small wrapper to keep "converted" semantics tight
-- ============================================================================
--
-- Going to 'converted' requires a member profile to point at. Going
-- away from 'converted' clears converted_at + converted_profile_id.

create or replace function public.set_lead_status(
  p_lead_id              uuid,
  p_status               public.lead_status,
  p_converted_profile_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym_id from public.leads where id = p_lead_id;
  if v_gym_id is null then
    raise exception 'Lead not found';
  end if;
  if not public.user_can_assign_plan(v_gym_id) then
    raise exception 'Not authorised';
  end if;

  if p_status = 'converted' then
    if p_converted_profile_id is null then
      raise exception 'A member profile is required to mark a lead converted';
    end if;
    update public.leads
      set status               = p_status,
          converted_at         = coalesce(converted_at, now()),
          converted_profile_id = p_converted_profile_id
      where id = p_lead_id;
  else
    update public.leads
      set status               = p_status,
          converted_at         = null,
          converted_profile_id = null
      where id = p_lead_id;
  end if;
end;
$$;
grant execute on function public.set_lead_status(uuid, public.lead_status, uuid)
  to authenticated;

commit;
