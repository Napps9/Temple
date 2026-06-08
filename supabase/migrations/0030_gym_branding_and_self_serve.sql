-- Self-serve gym creation, brand customisation, and the public
-- /join/[slug] signup link.
--
-- Branding columns on gyms (logo_url, three colours, public_signup
-- flag), a storage bucket for uploaded logos, and a thin layer of
-- security-definer RPCs that wrap creating a gym, joining one, and
-- editing the brand.
--
-- The brand columns get permissive defaults that match the current
-- hard-coded palette so an existing gym row looks identical
-- post-migration. Owners can change them via set_gym_branding.

begin;

-- ============================================================================
-- 1. Brand columns on gyms
-- ============================================================================

alter table public.gyms
  add column if not exists logo_url        text,
  add column if not exists primary_color   text not null default '#2563EB'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists secondary_color text not null default '#0F172A'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists text_color      text not null default '#0F172A'
    check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists public_signup_enabled boolean not null default true;

-- ============================================================================
-- 2. Storage bucket for gym logos
-- ============================================================================
--
-- Files are uploaded under <gym_id>/<filename> so the storage policies
-- can use the first path segment to verify the writer is the owner of
-- that gym. Public read so the <Image> tag can render the logo for
-- anyone hitting /join/[slug] before signing in.

insert into storage.buckets (id, name, public)
  values ('gym-logos', 'gym-logos', true)
  on conflict (id) do nothing;

drop policy if exists gym_logos_public_read   on storage.objects;
drop policy if exists gym_logos_owner_insert  on storage.objects;
drop policy if exists gym_logos_owner_update  on storage.objects;
drop policy if exists gym_logos_owner_delete  on storage.objects;

create policy gym_logos_public_read on storage.objects
  for select using (bucket_id = 'gym-logos');

create policy gym_logos_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'gym-logos'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and gm.role = 'owner'
        and (storage.foldername(name))[1] = gm.gym_id::text
    )
  );

create policy gym_logos_owner_update on storage.objects
  for update using (
    bucket_id = 'gym-logos'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and gm.role = 'owner'
        and (storage.foldername(name))[1] = gm.gym_id::text
    )
  );

create policy gym_logos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'gym-logos'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and gm.role = 'owner'
        and (storage.foldername(name))[1] = gm.gym_id::text
    )
  );

-- ============================================================================
-- 3. gym_by_slug — public lookup for the /join/[slug] flow
-- ============================================================================
--
-- The existing gyms_member_select RLS policy gates SELECT on
-- user_belongs_to. The /join/[slug] route needs to render the gym
-- card (name + logo + colours) before the visitor signs in / is a
-- member, so we expose a security-definer function that returns just
-- the public fields. Granted to anon so the unauthenticated form
-- works.

create or replace function public.gym_by_slug(p_slug text)
returns table (
  id                    uuid,
  name                  text,
  slug                  text,
  logo_url              text,
  primary_color         text,
  secondary_color       text,
  text_color            text,
  public_signup_enabled boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select g.id, g.name, g.slug, g.logo_url,
         g.primary_color, g.secondary_color, g.text_color,
         g.public_signup_enabled
  from public.gyms g
  where g.slug = lower(p_slug);
$$;
grant execute on function public.gym_by_slug(text) to anon, authenticated;

-- ============================================================================
-- 4. create_gym — caller becomes owner
-- ============================================================================

create or replace function public.create_gym(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]', '', 'gi'));
  if length(v_slug) = 0 then
    raise exception 'Slug must contain at least one letter or digit';
  end if;
  if exists (select 1 from public.gyms where slug = v_slug) then
    raise exception 'Slug already taken';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Gym name is required';
  end if;
  insert into public.gyms (name, slug)
    values (trim(p_name), v_slug)
    returning id into v_gym;
  insert into public.gym_memberships (gym_id, profile_id, role)
    values (v_gym, v_uid, 'owner');
  return v_gym;
end;
$$;
grant execute on function public.create_gym(text, text) to authenticated;

-- ============================================================================
-- 5. join_gym_by_slug — public member signup
-- ============================================================================

create or replace function public.join_gym_by_slug(p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, public_signup_enabled
    into v_gym, v_enabled
    from public.gyms where slug = lower(p_slug);
  if v_gym is null then
    raise exception 'Gym not found';
  end if;
  if not v_enabled then
    raise exception 'Public signup is disabled for this gym';
  end if;
  insert into public.gym_memberships (gym_id, profile_id, role)
    values (v_gym, v_uid, 'member')
    on conflict (gym_id, profile_id) do update
      set left_at = null;
  return v_gym;
end;
$$;
grant execute on function public.join_gym_by_slug(text) to authenticated;

-- ============================================================================
-- 6. Owner-only edits — branding, name, slug, public_signup
-- ============================================================================

create or replace function public.set_gym_branding(
  p_gym_id          uuid,
  p_logo_url        text,
  p_primary_color   text,
  p_secondary_color text,
  p_text_color      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  update public.gyms
    set logo_url        = p_logo_url,
        primary_color   = p_primary_color,
        secondary_color = p_secondary_color,
        text_color      = p_text_color
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_branding(uuid, text, text, text, text) to authenticated;

create or replace function public.set_gym_name(p_gym_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name cannot be empty';
  end if;
  update public.gyms set name = trim(p_name) where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_name(uuid, text) to authenticated;

create or replace function public.set_gym_slug(p_gym_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]', '', 'gi'));
  if length(v_slug) = 0 then
    raise exception 'Slug must contain at least one letter or digit';
  end if;
  if exists (select 1 from public.gyms where slug = v_slug and id <> p_gym_id) then
    raise exception 'Slug already taken';
  end if;
  update public.gyms set slug = v_slug where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_slug(uuid, text) to authenticated;

create or replace function public.set_gym_public_signup(
  p_gym_id uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  update public.gyms set public_signup_enabled = p_enabled where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_public_signup(uuid, boolean) to authenticated;

commit;
