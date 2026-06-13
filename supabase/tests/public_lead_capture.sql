-- capture_public_lead (0064): anonymous lead capture, gated on the
-- gym's opt-in flag, with a 30-day same-email dedup.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@plc.test');
  v_gym   uuid := _test_mk_gym('Public Lead Gym', 'public-lead');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
end $$;

-- 1. Capture refused while the flag is off (default).
select throws_like(
  $$ select public.capture_public_lead('public-lead', 'Alex Prospect', 'alex@x.com', null, 'Morning classes?') $$,
  '%not accepting enquiries%',
  'capture is refused while public_lead_capture_enabled is false'
);

-- 2. Owner enables it via the RPC.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$ begin
  perform set_gym_public_lead_capture(current_setting('test.gym')::uuid, true);
end $$;

-- 3. Capture now succeeds and creates a cold, unattributed lead.
do $$ begin reset role; end $$;
do $$ begin
  perform public.capture_public_lead(
    'public-lead', 'Alex Prospect', 'alex@x.com', '+44 7700 900000', 'Morning classes?');
end $$;

select is(
  (select count(*)::int from public.leads
   where gym_id = current_setting('test.gym')::uuid
     and lower(email) = 'alex@x.com'),
  1,
  'a single lead row is created on first capture'
);

select is(
  (select status::text from public.leads
   where gym_id = current_setting('test.gym')::uuid
     and lower(email) = 'alex@x.com'),
  'cold',
  'public capture lands as a cold lead'
);

select is(
  (select captured_by from public.leads
   where gym_id = current_setting('test.gym')::uuid
     and lower(email) = 'alex@x.com'),
  null,
  'public capture has no captured_by (anonymous)'
);

-- 4. A second capture with the same email dedups (no new row).
do $$ begin
  perform public.capture_public_lead(
    'public-lead', 'Alex Prospect', 'alex@x.com', null, 'Still interested!');
end $$;

select is(
  (select count(*)::int from public.leads
   where gym_id = current_setting('test.gym')::uuid
     and lower(email) = 'alex@x.com'),
  1,
  'a repeat capture of the same email dedups instead of inserting'
);

-- 5. Invalid email is rejected.
select throws_like(
  $$ select public.capture_public_lead('public-lead', 'Bad Email', 'not-an-email', null, null) $$,
  '%valid email%',
  'an obviously malformed email is rejected'
);

select * from finish();
rollback;
