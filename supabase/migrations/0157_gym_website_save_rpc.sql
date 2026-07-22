-- Site builder — server-side save with validation.
--
-- The editor autosaved by writing gym_websites.design directly from the
-- client. RLS gated WHO could write, but nothing validated WHAT — the
-- `design` jsonb had no size bound, no theme check, and image URL fields
-- (hero/about imageUrl, gallery images[].url) were stored verbatim, so a
-- `javascript:`/`data:` URL could be persisted and later injected into an
-- <img src> / CSS url() by the renderer. This routes the save through a
-- SECURITY DEFINER RPC that:
--
--   1. re-asserts capability + entitlement (SECURITY DEFINER bypasses RLS);
--   2. caps the document size;
--   3. rejects any image URL that isn't http(s) or empty;
--   4. rejects an unknown theme id (the registry is TS-side — brand-themes.ts
--      ThemeId — so the valid set is inlined here and must be kept in sync);
--   5. enforces optimistic concurrency against updated_at, so a second
--      browser tab that saved in the meantime can't be silently clobbered.
--
-- Returns the new updated_at for the client to carry as its next
-- concurrency token. (Renderer-side URL sanitisation is added in parallel
-- as defence-in-depth for rows written before this RPC existed.)

begin;

-- Every image URL anywhere in the design document, as text. The design is
-- {version, settings, pages:[{blocks:[{imageUrl | images:[{url}]}]}]}, but
-- a recursive match on the two key names is robust to future block shapes.
create or replace function public._gym_website_image_urls(p_design jsonb)
returns setof text
language sql
immutable
as $$
  select u #>> '{}'
  from (
    select jsonb_path_query(p_design, 'lax $.**.imageUrl') as u
    union all
    select jsonb_path_query(p_design, 'lax $.**.url')
  ) q
  where jsonb_typeof(u) = 'string';
$$;

create function public.save_gym_website(
  p_gym_id uuid,
  p_design jsonb,
  p_theme text,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
  v_updated timestamptz;
begin
  if not public.effective_can(p_gym_id, 'can_manage_website') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.gyms g where g.id = p_gym_id and g.website_builder_enabled) then
    raise exception 'website_builder_disabled' using errcode = 'insufficient_privilege';
  end if;

  -- Theme must be a known registry id (brand-themes.ts ThemeId).
  if p_theme is null or p_theme not in ('forged', 'ringside', 'daybreak', 'baseline') then
    raise exception 'invalid_theme' using errcode = 'check_violation';
  end if;

  -- Size cap — a marketing site's block document, image URLs not blobs.
  if pg_column_size(p_design) > 512 * 1024 then
    raise exception 'design_too_large' using errcode = 'check_violation';
  end if;

  -- No non-http(s) image URLs (blocks javascript:/data:/etc). Empty allowed.
  if exists (
    select 1 from public._gym_website_image_urls(p_design) as url
    where url <> '' and url !~* '^https?://'
  ) then
    raise exception 'invalid_image_url' using errcode = 'check_violation';
  end if;

  select updated_at into v_current
    from public.gym_websites
    where gym_id = p_gym_id
    for update;

  if v_current is null then
    raise exception 'no_site' using errcode = 'no_data_found';
  end if;

  -- Optimistic concurrency. Truncate to milliseconds: the client round-trips
  -- updated_at through a JS Date (ms precision) while Postgres stores µs, so
  -- an exact match would spuriously fail. A null token means "force" (skip).
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_current) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using errcode = 'serialization_failure',
      message = 'This site was changed in another tab. Reload before saving.';
  end if;

  update public.gym_websites
    set design = p_design,
        theme = p_theme
    where gym_id = p_gym_id
    returning updated_at into v_updated;

  return v_updated;
end;
$$;
grant execute on function public.save_gym_website(uuid, jsonb, text, timestamptz) to authenticated;

commit;
