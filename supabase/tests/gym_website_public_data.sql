-- gym_public_schedule / gym_public_plans (0098): both are SECURITY
-- DEFINER and bypass the base tables' RLS, so the one thing that
-- actually matters to test is that they refuse to expose anything for
-- a gym with no published site — that's the only gate standing between
-- "public marketing page" and "every gym's schedule/pricing is
-- incidentally anon-readable".

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@pubdata.test');
  v_coach uuid := _test_mk_user('coach@pubdata.test');
  v_gym   uuid := _test_mk_gym('Public Data Gym', 'public-data-gym');
  v_plan  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  -- A session in the next 7 days (visible once published) and one
  -- 10 days out (out of the "this week" window, should never appear).
  perform _test_mk_session(v_gym, v_coach, now() + interval '2 days');
  perform _test_mk_session(v_gym, v_coach, now() + interval '10 days');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 12000)
    returning plan_id into v_plan;

  perform set_config('test.gym', v_gym::text, true);
end $$;

-- 1-2. No published site yet — both RPCs return nothing, even though
-- the underlying rows exist.
select is(
  (select count(*)::int from public.gym_public_schedule('public-data-gym')),
  0,
  'gym_public_schedule returns nothing before the site is published'
);
select is(
  (select count(*)::int from public.gym_public_plans('public-data-gym')),
  0,
  'gym_public_plans returns nothing before the site is published'
);

-- 3. Publish the site (bypasses RLS as the test superuser — still
-- before any _test_act_as call in this file).
do $$ begin
  insert into public.gym_websites (gym_id, published)
    values (current_setting('test.gym')::uuid, true);
end $$;

-- 4. Now the schedule shows only the session inside the 7-day window.
select is(
  (select count(*)::int from public.gym_public_schedule('public-data-gym')),
  1,
  'gym_public_schedule only returns sessions in the next 7 days'
);

-- 5. And pricing shows the plan.
select is(
  (select name from public.gym_public_plans('public-data-gym')),
  'Unlimited',
  'gym_public_plans surfaces the plan once the site is published'
);

select * from finish();
rollback;
