-- Test helpers shared across the Tier 5 pgTAP suite.
--
-- Conventions:
--   - Each test file BEGINs, plans, asserts, finishes, and ROLLBACKs.
--   - Each test file includes this helper via `\i tests/_helpers.sql`
--     OR copies the function signatures it needs (Supabase test
--     runners vary on whether `\i` is supported).
--   - All IDs are deterministic in tests so failure messages read
--     clearly; reset via pgcrypto's gen_random_uuid only when the
--     test cares about uniqueness.
--
-- Auth simulation: we set request.jwt.claim.sub via SET LOCAL, which
-- is what auth.uid() reads. The 'authenticated' role gates the
-- standard RLS surface.

-- Inserts a fully-formed auth.users row with the minimum required
-- columns; returns the id. Tests use this to get a "signed-in" user.
create or replace function public._test_mk_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', p_email,
    '',
    now(), '{}', '{}', now(), now()
  );
  insert into public.profiles (id, full_name) values (v_id, p_email);
  return v_id;
end;
$$;

-- Creates a gym with a deterministic slug and returns the gym id.
create or replace function public._test_mk_gym(p_name text, p_slug text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.gyms (name, slug) values (p_name, p_slug)
  returning id into v_id;
  return v_id;
end;
$$;

-- Attaches a profile to a gym with a given role.
create or replace function public._test_mk_membership(
  p_gym uuid, p_profile uuid, p_role public.gym_role
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.gym_memberships (gym_id, profile_id, role)
  values (p_gym, p_profile, p_role)
  on conflict (gym_id, profile_id) do update set role = excluded.role
  returning id into v_id;
  return v_id;
end;
$$;

-- Simulates that the given profile_id is the signed-in user.
-- Subsequent RLS-gated calls run as that user.
create or replace function public._test_act_as(p_profile uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Returns a class_session row id for a coach in a gym at a given
-- start time, with a fresh class_type if none provided.
create or replace function public._test_mk_session(
  p_gym uuid,
  p_coach uuid,
  p_starts_at timestamptz,
  p_duration int default 60,
  p_class_type uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_ct uuid := p_class_type;
begin
  if v_ct is null then
    insert into public.class_types (gym_id, name, color)
    values (p_gym, 'Test class ' || gen_random_uuid()::text, '#2563EB')
    returning id into v_ct;
  end if;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values
    (p_gym, 'Test', p_coach, p_starts_at, p_duration, 12, p_coach, v_ct)
  returning id into v_id;
  return v_id;
end;
$$;

-- Books a class for a profile (bypasses RLS — used to set up
-- attendance fixtures without going through book_class).
create or replace function public._test_mk_booking(
  p_session uuid, p_profile uuid
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_sessions where id = p_session;
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, p_session, p_profile)
  returning id into v_id;
  return v_id;
end;
$$;
