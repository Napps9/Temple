-- Light + dark brand. Existing brand columns are treated as the
-- light-mode set (the chrome they've been driving all along). Four
-- new nullable columns hold the dark-mode siblings — when null, the
-- client auto-derives them from light using WCAG contrast against the
-- dark screen background (see src/lib/brand-derivation.ts). The dark
-- columns therefore stay nullable on purpose: an explicit null is the
-- "use the auto-derived value" sentinel.
--
-- The Advanced branding editor on /management/branding writes the
-- whole pair through set_gym_branding (extended below to take both
-- modes). The public /join/[slug] flow reads them from gym_by_slug.

begin;

-- ============================================================================
-- 1. Schema
-- ============================================================================

alter table public.gyms
  add column if not exists logo_url_dark        text,
  add column if not exists primary_color_dark   text
    check (primary_color_dark is null
           or primary_color_dark ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists secondary_color_dark text
    check (secondary_color_dark is null
           or secondary_color_dark ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists text_color_dark      text
    check (text_color_dark is null
           or text_color_dark ~ '^#[0-9A-Fa-f]{6}$');

-- ============================================================================
-- 2. set_gym_branding — extended to write the dark variants too
-- ============================================================================
--
-- All dark params have null defaults so the existing client callsite
-- (5 args) keeps working — those calls leave the dark columns null,
-- which the read path treats as "auto-derive at render time." The
-- explicit DROP is needed because `create or replace` won't change a
-- function's arity in place; without it, Postgres ends up with both
-- a 5-arg and a 9-arg overload, which can resolve ambiguously when
-- the 9-arg form is called with the dark args defaulted.

drop function if exists public.set_gym_branding(uuid, text, text, text, text);

create or replace function public.set_gym_branding(
  p_gym_id          uuid,
  p_logo_url        text,
  p_primary_color   text,
  p_secondary_color text,
  p_text_color      text,
  p_logo_url_dark        text default null,
  p_primary_color_dark   text default null,
  p_secondary_color_dark text default null,
  p_text_color_dark      text default null
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
    set logo_url             = p_logo_url,
        primary_color        = p_primary_color,
        secondary_color      = p_secondary_color,
        text_color           = p_text_color,
        logo_url_dark        = p_logo_url_dark,
        primary_color_dark   = p_primary_color_dark,
        secondary_color_dark = p_secondary_color_dark,
        text_color_dark      = p_text_color_dark
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_gym_branding(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;

-- ============================================================================
-- 3. gym_by_slug — expose the dark variants on the public read
-- ============================================================================
--
-- Adding columns to a `returns table (...)` shape is a return-type
-- change, so `create or replace` raises SQLSTATE 42P13 — the function
-- has to be dropped and recreated. The signature (arg list) is
-- unchanged so callers don't notice.

drop function if exists public.gym_by_slug(text);

create or replace function public.gym_by_slug(p_slug text)
returns table (
  id                    uuid,
  name                  text,
  slug                  text,
  logo_url              text,
  primary_color         text,
  secondary_color       text,
  text_color            text,
  public_signup_enabled boolean,
  logo_url_dark         text,
  primary_color_dark    text,
  secondary_color_dark  text,
  text_color_dark       text
)
language sql
security definer
stable
set search_path = public
as $$
  select g.id, g.name, g.slug, g.logo_url,
         g.primary_color, g.secondary_color, g.text_color,
         g.public_signup_enabled,
         g.logo_url_dark, g.primary_color_dark,
         g.secondary_color_dark, g.text_color_dark
  from public.gyms g
  where g.slug = lower(p_slug);
$$;

grant execute on function public.gym_by_slug(text) to anon, authenticated;

commit;
