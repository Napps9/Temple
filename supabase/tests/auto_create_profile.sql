-- 0042: an auth.users insert should auto-create a profiles row, with
-- full_name pulled from raw_user_meta_data. This is the trigger that
-- fixes the "new row violates row-level security policy for table
-- profiles" error the public signup flow hit when supabase.auth.signUp
-- returned a user but no session.

begin;
select plan(3);

\ir _helpers.psql

-- 1. Insert an auth user with full_name in metadata; the trigger
--    creates the matching profiles row.
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', 'with-name@trigger.test',
    '', now(),
    '{}'::jsonb,
    jsonb_build_object('full_name', 'Test Member'),
    now(), now()
  );
  perform set_config('test.with_name_id', v_id::text, true);
end $$;

select is(
  (select full_name from public.profiles
   where id = current_setting('test.with_name_id')::uuid),
  'Test Member',
  'trigger creates a profile with full_name from raw_user_meta_data'
);

-- 2. Insert an auth user with no full_name in metadata; the trigger
--    still creates a profile row, with null full_name (the account
--    screen lets the user set it later).
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', 'no-name@trigger.test',
    '', now(),
    '{}'::jsonb, '{}'::jsonb,
    now(), now()
  );
  perform set_config('test.no_name_id', v_id::text, true);
end $$;

select is(
  (select count(*)::int from public.profiles
   where id = current_setting('test.no_name_id')::uuid
     and full_name is null),
  1,
  'trigger creates a profile with null full_name when metadata is empty'
);

-- 3. The helper-driven path still works: _test_mk_user upserts the
--    profile with p_email, so existing tests that read profiles
--    keep the email-as-name fixture they expect.
do $$
declare v_id uuid := _test_mk_user('helper@trigger.test');
begin
  perform set_config('test.helper_id', v_id::text, true);
end $$;

select is(
  (select full_name from public.profiles
   where id = current_setting('test.helper_id')::uuid),
  'helper@trigger.test',
  '_test_mk_user upsert wins over the trigger''s null full_name'
);

select * from finish();
rollback;
