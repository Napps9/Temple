-- Public lookup of the inviting gym's display info from an invite code.
--
-- The accept-invite screen only has the opaque code from the emailed link,
-- but a member accepting an invite should see whose gym they're joining —
-- name, logo, brand — the same welcome the public /join/[slug] screen gives
-- (gym_by_slug). This is the code-keyed sibling of that lookup.
--
-- security definer + granted to anon so a not-yet-signed-up invitee can read
-- it. It exposes only gym display fields (never membership/contact data) and
-- returns nothing for an unknown, already-used, or expired code.

create or replace function public.invite_code_gym(p_code text)
returns table (
  gym_id             uuid,
  name               text,
  logo_url           text,
  primary_color      text,
  secondary_color    text,
  text_color         text,
  logo_url_dark      text,
  primary_color_dark text,
  role               public.gym_role
)
language sql
security definer
stable
set search_path = public
as $$
  select g.id, g.name, g.logo_url,
         g.primary_color, g.secondary_color, g.text_color,
         g.logo_url_dark, g.primary_color_dark,
         i.role
  from public.invite_codes i
  join public.gyms g on g.id = i.gym_id
  where i.code = p_code
    and i.used_at is null
    and (i.expires_at is null or i.expires_at > now());
$$;

grant execute on function public.invite_code_gym(text) to anon, authenticated;
