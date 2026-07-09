-- 0110_allow_minors.sql
--
-- Under-18 handling. Temple has had no age gate: date of birth was captured
-- at /consent with only a "not in the future" check, so a member could be a
-- minor with no parental consent and no gym control. This adds:
--
--   1. gyms.allow_minors — an owner-controlled opt-in (default FALSE, so a
--      gym cannot enrol under-18s until it deliberately turns this on).
--   2. Guardian columns on member_consents + record_consent extended to
--      capture a parent/guardian's consent for a minor.
--   3. A server-side check in record_consent: a member whose date of birth
--      makes them under 18 can only record consent (and therefore enter) if
--      their gym has opted in — so the rule is enforced, not just asked for
--      in the UI. Solo/Temple-direct signups are blocked at 18+ in the app
--      (no gym, no guardian path).

-- 1. Gym opt-in ------------------------------------------------------------

alter table public.gyms
  add column if not exists allow_minors boolean not null default false;

-- Owner-only setter (mirrors set_require_membership_to_book, 0082).
create or replace function public.set_allow_minors(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change this setting';
  end if;
  update public.gyms
    set allow_minors = p_enabled
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_allow_minors(uuid, boolean) to authenticated;

-- 2. Guardian consent record ----------------------------------------------

alter table public.member_consents
  add column if not exists guardian_name text,
  add column if not exists guardian_contact text;

-- 3. record_consent: capture guardian details + enforce the gym opt-in.
-- Arity changes, so DROP first (CREATE OR REPLACE can't change signature).
drop function if exists public.record_consent(uuid, text, text);

create function public.record_consent(
  p_gym_id          uuid,
  p_policy_version  text,
  p_lawful_basis    text default 'consent',
  p_guardian_name   text default null,
  p_guardian_contact text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_minor boolean;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id and gm.profile_id = v_caller and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  -- Age is read from the profile (written just before this call), so the
  -- check can't be bypassed by a tampered client.
  select p.date_of_birth is not null
     and p.date_of_birth > (current_date - interval '18 years')
    into v_is_minor
    from public.profiles p where p.id = v_caller;

  if coalesce(v_is_minor, false)
     and not coalesce((select allow_minors from public.gyms where id = p_gym_id), false)
  then
    raise exception 'This gym does not accept members under 18';
  end if;

  insert into public.member_consents
    (gym_id, profile_id, policy_version, lawful_basis, guardian_name, guardian_contact)
  values (
    p_gym_id, v_caller, p_policy_version,
    case
      when p_guardian_name is not null and length(trim(p_guardian_name)) > 0
        then 'parental_consent'
      else coalesce(p_lawful_basis, 'consent')
    end,
    p_guardian_name, p_guardian_contact)
  on conflict (gym_id, profile_id, policy_version) do nothing;
end;
$$;
grant execute on function public.record_consent(uuid, text, text, text, text) to authenticated;
