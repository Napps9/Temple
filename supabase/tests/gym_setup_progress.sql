-- get_gym_setup_progress reflects the actual gym state, step by step.
-- A fresh gym reports every step pending; doing each setup action
-- flips its matching flag. Nine steps in total — team / members
-- imported / workouts imported are optional client-side but the RPC
-- still reports them.

begin;
select plan(13);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@setup.test');
  v_gym   uuid := _test_mk_gym('Setup Gym', 'setup-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform _test_act_as(v_owner);
end $$;

-- 1. Fresh gym: every step pending.
select is(
  (select count(*) from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where done)::int,
  0,
  'a fresh gym reports zero setup steps complete'
);

-- 2. logo flips after gyms.logo_url is set.
do $$
begin
  reset role;
  update public.gyms set logo_url = 'https://example.com/logo.png'
    where id = current_setting('test.gym')::uuid;
  perform _test_act_as(current_setting('test.owner')::uuid);
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'logo'),
  true,
  'logo step flips done when a logo url is present'
);

-- 3. settings flips after the owner saves gym settings once. Driven
-- through the RPC (which stamps operating_defaults_reviewed_at) rather
-- than a raw update, so we exercise the real save path.
do $$
begin
  perform public.set_gym_operating_defaults(
    current_setting('test.gym')::uuid,
    'mon', 'UTC', 12, 60, 7, 365, 3, 30, 'credits_first'
  );
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'settings'),
  true,
  'settings step flips done once gym settings have been saved'
);

-- 4. class_type_and_schedule flips done after the first class type
-- exists (complete = 1/2 until the schedule is added too).
do $$
declare v_ct uuid;
begin
  insert into public.class_types (gym_id, name, color)
    values (current_setting('test.gym')::uuid, 'CrossFit', '#10B981')
    returning id into v_ct;
  perform set_config('test.ct', v_ct::text, true);
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'class_type_and_schedule'),
  true,
  'class_type_and_schedule step flips done when the first class type exists'
);

-- 5. After adding the recurrence the combined step's complete count
-- rises to 2/2 — fully complete.
do $$
begin
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes,
     capacity, starts_on, tz, created_by)
  values
    (current_setting('test.gym')::uuid,
     current_setting('test.ct')::uuid,
     array[1,3,5], array['09:00'], 60, 12, current_date, 'UTC',
     current_setting('test.owner')::uuid);
end $$;

select is(
  (select (complete::text || '/' || target::text)
   from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'class_type_and_schedule'),
  '2/2',
  'class_type_and_schedule sub-count: type + recurrence → 2/2'
);

-- 6. parq flips after publishing an active questionnaire.
do $$
begin
  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (current_setting('test.gym')::uuid, 1,
            current_setting('test.owner')::uuid);
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'parq'),
  true,
  'parq step flips done when an active questionnaire is published'
);

-- 7. plan flips after a membership plan is added.
do $$
begin
  insert into public.membership_plans (gym_id, name, kind)
    values (current_setting('test.gym')::uuid, 'Unlimited', 'unlimited');
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'plan'),
  true,
  'plan step flips done when an active membership plan exists'
);

-- 8. team flips after an invite code is generated.
do $$
begin
  insert into public.invite_codes (gym_id, code, role, created_by)
    values (current_setting('test.gym')::uuid,
            'TEAM-INVITE-' || substr(gen_random_uuid()::text, 1, 8),
            'coach',
            current_setting('test.owner')::uuid);
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'team'),
  true,
  'team step flips done when an invite code has been generated'
);

-- 9. members_imported flips once a pending_members row exists. Staged
-- through the RPC rather than a direct insert: 0216 revoked the client's
-- table-wide write on pending_members, and every real staging path in the
-- app goes through this function anyway.
do $$
begin
  perform public.import_pending_members(
    current_setting('test.gym')::uuid,
    jsonb_build_array(jsonb_build_object(
      'email', 'imported@setup.test',
      'full_name', 'Imported Member'))
  );
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'members_imported'),
  true,
  'members_imported flips done once a pending_members row exists'
);

-- 9b. stripe flips done once a connected Stripe account row exists. The
-- insert bypasses RLS (there's no owner INSERT policy — the edge function
-- writes it with the service role), mirroring the logo update above.
do $$
begin
  reset role;
  insert into public.gym_stripe_accounts (gym_id, stripe_account_id)
    values (current_setting('test.gym')::uuid, 'acct_setuptest');
  perform _test_act_as(current_setting('test.owner')::uuid);
end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'stripe'),
  true,
  'stripe step flips done when a connected Stripe account exists'
);

-- 10. Eight of nine complete (skipping workouts_imported which requires a
-- linked profile + tracked_workouts row — covered in
-- import_member_workouts.sql).
select is(
  (select count(*) from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where done)::int,
  8,
  'eight of nine steps report done; workouts_imported needs a tracked workout'
);

-- 11-12. Sub-step counts on the remaining multi-part steps. logo and
-- parq each have target 2 (light + dark logo; waiver + parq) — we've
-- only set one of each, so complete = 1 even though `done` already
-- flipped.
select is(
  (select (complete::text || '/' || target::text)
   from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'logo'),
  '1/2',
  'logo sub-count: light logo set, dark logo blank → 1/2'
);

select is(
  (select (complete::text || '/' || target::text)
   from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'parq'),
  '1/2',
  'parq sub-count: PAR-Q published, no waiver → 1/2'
);

select * from finish();
rollback;
