-- Site builder — Phase A.
--
-- A block-based public website per gym, editable by staff in Manage.
-- Deliberately mirrors the email campaign builder's shape (0044) rather
-- than inventing a new pattern: one jsonb `design` document per row
-- (version, blocks[], settings), no separate per-block table. The block
-- types and coercion-on-read approach in src/lib/site-blocks.ts follow
-- src/lib/email/blocks.ts directly. One deliberate difference: `design`
-- only stores a themeId, never baked-in theme colours (see part 4
-- below) — both this and the email builder import the same shared
-- src/lib/brand-themes.ts registry so a gym's site and its marketing
-- emails can use the same named look.
--
-- Entitlement: website_builder_enabled on gyms, default false. Unlike
-- store_enabled or public_lead_capture_enabled, this has NO owner-facing
-- setter RPC — it's a paid add-on with no self-serve Temple-side billing
-- yet (see the site-builder plan's billing decision, Path A), so Temple
-- staff flips it directly after an external invoice/handshake. The
-- capability below still gates who on a gym's own staff can use the
-- editor once the gym has it; it does not grant the entitlement itself.
--
-- Public read goes through a SECURITY DEFINER RPC (gym_website_by_slug),
-- same shape as gym_by_slug (0030) and capture_public_lead (0064) —
-- gym_websites RLS is staff-only, so an anonymous visitor can't read it
-- directly, and the RPC only ever returns published rows.

begin;

-- ============================================================================
-- 1. Capability — register before any policy references it.
-- ============================================================================

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_manage_website'         then p_role = 'admin'
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 2. Entitlement flag — Temple-ops-only, no owner setter RPC by design.
-- ============================================================================

alter table public.gyms
  add column if not exists website_builder_enabled boolean not null default false;

-- ============================================================================
-- 3. gym_websites — one row per gym, jsonb design document.
-- ============================================================================

create table public.gym_websites (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null unique references public.gyms(id) on delete cascade,
  theme              text not null default 'forged',
  design             jsonb not null default '{"version":1,"blocks":[],"settings":{}}'::jsonb,
  published          boolean not null default false,
  custom_domain      text,
  domain_verified_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index gym_websites_gym_idx on public.gym_websites (gym_id);

alter table public.gym_websites enable row level security;

create policy gym_websites_select on public.gym_websites
  for select using (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  );
create policy gym_websites_insert on public.gym_websites
  for insert with check (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  );
create policy gym_websites_update on public.gym_websites
  for update using (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  )
  with check (public.effective_can(gym_id, 'can_manage_website'));
create policy gym_websites_delete on public.gym_websites
  for delete using (public.effective_can(gym_id, 'can_manage_website'));

-- ============================================================================
-- 4. Public read — anon-accessible, published sites only.
--
-- Returns the gym's CURRENT brand colour/logo, not a snapshot — unlike
-- an email campaign (sent once, then archived), a published site should
-- reflect a brand-colour change made after the theme was picked, without
-- the owner needing to "reapply" anything. The theme itself is composed
-- with this colour at render time (src/lib/brand-themes.ts,
-- composeThemeWithBrand), not baked into the stored `design`.
-- ============================================================================

create function public.gym_website_by_slug(p_slug text)
returns table (
  gym_id             uuid,
  gym_name           text,
  gym_logo_url       text,
  gym_primary_color  text,
  theme              text,
  design             jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select w.gym_id, g.name, g.logo_url, g.primary_color, w.theme, w.design
  from public.gym_websites w
  join public.gyms g on g.id = w.gym_id
  where g.slug = lower(p_slug)
    and w.published = true;
$$;
grant execute on function public.gym_website_by_slug(text) to anon, authenticated;

-- ============================================================================
-- 5. Storage — gym-website-assets, same shape as store-product-images.
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('gym-website-assets', 'gym-website-assets', true)
  on conflict (id) do nothing;

drop policy if exists website_assets_public_read  on storage.objects;
drop policy if exists website_assets_staff_insert on storage.objects;
drop policy if exists website_assets_staff_delete on storage.objects;

create policy website_assets_public_read on storage.objects
  for select using (bucket_id = 'gym-website-assets');

-- Folder segment compared as text, not cast to uuid — same reasoning as
-- the store bucket policies this mirrors (0085): this policy runs
-- against every bucket's inserts, and a non-uuid folder elsewhere would
-- error the cast.
create policy website_assets_staff_insert on storage.objects
  for insert with check (
    bucket_id = 'gym-website-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_website')
    )
  );

create policy website_assets_staff_delete on storage.objects
  for delete using (
    bucket_id = 'gym-website-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_website')
    )
  );

commit;
