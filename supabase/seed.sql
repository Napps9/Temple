-- Local development seed.
--
-- Creates two sign-in-able users and wires them into a demo gym:
--   owner@temple.test  / password123
--   member@temple.test / password123
--
-- Runs only on local `supabase db reset` — `supabase db push` never
-- executes seed.sql, so these credentials can't reach the hosted
-- project. Idempotent: every insert is guarded so repeated resets are
-- clean.
--
-- The auth.users insert mirrors what GoTrue writes on signup:
-- bcrypt-hashed password (GoTrue verifies crypt()'s $2a$ output), a
-- confirmed email, and a matching auth.identities row — without the
-- identity row email/password sign-in fails even when the user exists.
-- The various *_token / email_change / phone_change columns MUST be
-- empty strings, not NULL: GoTrue scans them into non-nullable Go
-- strings and a NULL turns every sign-in into
-- "Database error querying schema".

do $$
declare
  v_owner_id  uuid := '11111111-1111-1111-1111-111111111111';
  v_member_id uuid := '22222222-2222-2222-2222-222222222222';
  v_gym_id    uuid;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
     created_at, updated_at,
     confirmation_token, recovery_token,
     email_change, email_change_token_new, email_change_token_current,
     phone_change, phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner_id,
     'authenticated', 'authenticated', 'owner@temple.test',
     extensions.crypt('password123', extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(),
     '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_member_id,
     'authenticated', 'authenticated', 'member@temple.test',
     extensions.crypt('password123', extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(),
     '', '', '', '', '', '', '', '')
  on conflict (id) do nothing;

  insert into auth.identities
    (id, user_id, provider_id, provider, identity_data,
     last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, 'email',
         jsonb_build_object(
           'sub', u.id::text,
           'email', u.email,
           'email_verified', true
         ),
         now(), now(), now()
  from auth.users u
  where u.id in (v_owner_id, v_member_id)
    and not exists (
      select 1 from auth.identities i
      where i.user_id = u.id and i.provider = 'email'
    );

  insert into public.profiles (id, full_name) values
    (v_owner_id,  'Iron Temple Owner'),
    (v_member_id, 'Demo Member')
  on conflict (id) do nothing;

  select id into v_gym_id from public.gyms where slug = 'iron-temple';
  if v_gym_id is null then
    insert into public.gyms (name, slug)
    values ('Iron Temple', 'iron-temple')
    returning id into v_gym_id;
  end if;

  insert into public.gym_memberships (gym_id, profile_id, role) values
    (v_gym_id, v_owner_id,  'owner'),
    (v_gym_id, v_member_id, 'member')
  on conflict do nothing;

  raise notice 'Seed applied: gym % — sign in as owner@temple.test / password123.', v_gym_id;
end;
$$;
