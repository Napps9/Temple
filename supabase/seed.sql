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

-- Lead-automation demo data. Two coaches to round-robin across, a couple
-- of sources, and a spread of leads including a stale one (assigned but
-- untouched for days) and a consented one, so the funnel + follow-up
-- surfaces have something to show on a fresh reset. Idempotent.
do $$
declare
  v_gym_id    uuid;
  v_member_id uuid := '22222222-2222-2222-2222-222222222222';
  v_coach1    uuid := '33333333-3333-3333-3333-333333333333';
  v_coach2    uuid := '44444444-4444-4444-4444-444444444444';
  v_src_ig    uuid := '55555555-5555-5555-5555-555555555551';
  v_src_walk  uuid := '55555555-5555-5555-5555-555555555552';
  v_lead      uuid;
begin
  select id into v_gym_id from public.gyms where slug = 'iron-temple';
  if v_gym_id is null then return; end if;
  -- Already seeded? bail.
  if exists (select 1 from public.leads where gym_id = v_gym_id) then return; end if;

  -- Two coach accounts (assignment targets; not set up to sign in).
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_coach1, 'authenticated', 'authenticated',
     'sarah@temple.test', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_coach2, 'authenticated', 'authenticated',
     'dan@temple.test', '', now(), '{}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name) values
    (v_coach1, 'Sarah Coach'),
    (v_coach2, 'Dan Coach')
  on conflict (id) do nothing;

  insert into public.gym_memberships (gym_id, profile_id, role) values
    (v_gym_id, v_coach1, 'coach'),
    (v_gym_id, v_coach2, 'coach')
  on conflict do nothing;

  insert into public.lead_sources (id, gym_id, label, color) values
    (v_src_ig,   v_gym_id, 'Instagram', '#EC4899'),
    (v_src_walk, v_gym_id, 'Walk-in',   '#10B981')
  on conflict (id) do nothing;

  -- A fresh, consented enquiry — auto-assigned by round-robin.
  insert into public.leads
    (gym_id, full_name, email, phone, source_id, notes, status,
     marketing_consent, consent_at, lawful_basis, consent_policy_version)
  values
    (v_gym_id, 'Jordan Fresh', 'jordan@example.test', '07700900001', v_src_ig,
     'Saw the Instagram reel, wants to try a class.', 'cold',
     true, now(), 'legitimate_interest', 'lead-capture-2026-07')
  returning id into v_lead;
  perform public.assign_lead(v_lead);

  -- A stale lead: assigned but untouched for three days (shows in the
  -- "Needs follow-up" filter).
  insert into public.leads (gym_id, full_name, email, source_id, notes, status)
  values (v_gym_id, 'Sam Stale', 'sam@example.test', v_src_walk,
          'Walked in Saturday, asked about pricing.', 'cold')
  returning id into v_lead;
  perform public.assign_lead(v_lead);
  update public.leads set assigned_at = now() - interval '3 days' where id = v_lead;

  -- One already contacted, one converted (links to the demo member).
  insert into public.leads (gym_id, full_name, email, source_id, status)
  values (v_gym_id, 'Pat Contacted', 'pat@example.test', v_src_ig, 'contacted')
  returning id into v_lead;
  perform public.assign_lead(v_lead);

  insert into public.leads
    (gym_id, full_name, email, source_id, status, converted_profile_id, converted_at)
  values (v_gym_id, 'Robin Converted', 'robin@example.test', v_src_walk,
          'converted', v_member_id, now() - interval '2 days');

  raise notice 'Lead-automation demo seeded for gym %.', v_gym_id;
end;
$$;

-- Email-automation demo: one enabled "welcome new members" automation so
-- the automations surface has something to show on a fresh reset. Idempotent.
do $$
declare
  v_gym_id   uuid;
  v_owner_id uuid := '11111111-1111-1111-1111-111111111111';
begin
  select id into v_gym_id from public.gyms where slug = 'iron-temple';
  if v_gym_id is null then return; end if;
  if exists (select 1 from public.email_automations where gym_id = v_gym_id) then return; end if;

  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, subject, preheader,
     compiled_html, compiled_text, created_by)
  values
    (v_gym_id, 'Welcome new members', true, 'member_joined', 4320,
     'Welcome to Iron Temple', 'Glad to have you on board',
     '<html><body><h1>Welcome to Iron Temple</h1><p>We''re glad you joined. '
       || 'Book your first class whenever you''re ready.</p>'
       || '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>',
     'Welcome to Iron Temple. Book your first class whenever you''re ready.',
     v_owner_id);

  raise notice 'Email-automation demo seeded for gym %.', v_gym_id;
end;
$$;
