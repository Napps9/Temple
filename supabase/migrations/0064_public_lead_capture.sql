-- Phase 3d — public lead-capture form.
--
-- A gym can share a URL (/lead/<slug>) that lets a prospect leave
-- their details without an account. The leads table (0056) is gated
-- by user_can_assign_plan, so an anonymous visitor can't write to it
-- directly; this migration adds a SECURITY DEFINER RPC granted to
-- anon that does its own validation.
--
-- Opt-in: gyms.public_lead_capture_enabled (default false). A gym
-- that hasn't turned it on rejects captures even if someone guesses
-- the URL. Owners toggle it from the Branding screen.
--
-- Abuse guard (v1): per-(gym, lower(email)) dedup inside a 30-day
-- window. A bot hammering the same address updates the existing
-- open lead's note/phone instead of creating duplicates. IP-level
-- throttling is a follow-up (would need an edge function in front).

begin;

-- ============================================================================
-- 1. Opt-in flag + owner toggle
-- ============================================================================

alter table public.gyms
  add column if not exists public_lead_capture_enabled boolean not null default false;

create or replace function public.set_gym_public_lead_capture(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change lead capture';
  end if;
  update public.gyms
    set public_lead_capture_enabled = p_enabled
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_gym_public_lead_capture(uuid, boolean)
  to authenticated;

-- ============================================================================
-- 2. gym_by_slug grows the flag (DROP + CREATE: RETURNS shape change)
-- ============================================================================

drop function if exists public.gym_by_slug(text);

create function public.gym_by_slug(p_slug text)
returns table (
  id                          uuid,
  name                        text,
  slug                        text,
  logo_url                    text,
  primary_color               text,
  secondary_color             text,
  text_color                  text,
  public_signup_enabled       boolean,
  logo_url_dark               text,
  primary_color_dark          text,
  secondary_color_dark        text,
  text_color_dark             text,
  public_lead_capture_enabled boolean
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
         g.secondary_color_dark, g.text_color_dark,
         g.public_lead_capture_enabled
  from public.gyms g
  where g.slug = lower(p_slug);
$$;
grant execute on function public.gym_by_slug(text) to anon, authenticated;

-- ============================================================================
-- 3. capture_public_lead — anonymous write path
-- ============================================================================

create or replace function public.capture_public_lead(
  p_slug      text,
  p_full_name text,
  p_email     text,
  p_phone     text default null,
  p_message   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym       uuid;
  v_enabled   boolean;
  v_email     text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_name      text := btrim(coalesce(p_full_name, ''));
  v_existing  uuid;
begin
  select id, public_lead_capture_enabled
    into v_gym, v_enabled
    from public.gyms
    where slug = lower(p_slug);
  if v_gym is null then
    raise exception 'Gym not found';
  end if;
  if not coalesce(v_enabled, false) then
    raise exception 'This gym is not accepting enquiries right now';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  -- Loose email shape check — the form validates properly, this just
  -- stops obvious junk. NULL email is allowed (phone-only enquiry).
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;

  -- Dedup: an open lead with this email captured in the last 30 days
  -- gets refreshed rather than duplicated.
  if v_email is not null then
    select id into v_existing
      from public.leads
      where gym_id = v_gym
        and lower(email) = v_email
        and status not in ('converted'::public.lead_status, 'lost'::public.lead_status)
        and captured_at >= now() - interval '30 days'
      order by captured_at desc
      limit 1;
  end if;

  if v_existing is not null then
    update public.leads
      set phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
          notes = case
            when nullif(btrim(coalesce(p_message, '')), '') is null then notes
            when notes is null then p_message
            else notes || E'\n— ' || p_message
          end,
          updated_at = now()
      where id = v_existing;
    return;
  end if;

  insert into public.leads
    (gym_id, full_name, email, phone, notes, status, captured_by)
  values
    (v_gym, v_name, v_email,
     nullif(btrim(coalesce(p_phone, '')), ''),
     nullif(btrim(coalesce(p_message, '')), ''),
     'cold'::public.lead_status,
     null);
end;
$$;
grant execute on function public.capture_public_lead(text, text, text, text, text)
  to anon, authenticated;

commit;
