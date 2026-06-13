-- gyms.subscription_resolution (added in 0049, wired in 0050) picks
-- which plan books a class when a member holds more than one. Three
-- modes:
--
--   credits_first    — earliest-expiring credit-based plan, then
--                       unlimited (preserves pre-0050 behaviour)
--   newest_first     — most recently created plan in each bucket
--   highest_priority — plan_subscriptions.priority desc within bucket
--
-- This test asserts each mode in isolation, plus that an explicit
-- entitlement choice via book_class(session_id, kind, id) is honoured
-- and that an ineligible choice is refused.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@subres.test');
  v_member  uuid := _test_mk_user('m@subres.test');
  v_gym     uuid := _test_mk_gym('Sub-resolution Gym', 'sub-res');
  v_plan_a  uuid;
  v_plan_b  uuid;
  v_sub_a   uuid;
  v_sub_b   uuid;
  v_gm      uuid;
  v_sess    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_gm := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Plan A (credits)', 'credit_pack', 10)
    returning plan_id into v_plan_a;
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Plan B (unlimited)', 'unlimited')
    returning plan_id into v_plan_b;

  -- Sub A: credit plan, older, low priority, finite credits
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status,
     credit_balance, priority, created_at)
  values
    (v_gm, v_member, v_gym, v_plan_a, 'active'::public.plan_sub_state,
     10, 0, now() - interval '60 days')
  returning id into v_sub_a;

  -- Sub B: unlimited plan, newer, higher priority
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status,
     priority, created_at)
  values
    (v_gm, v_member, v_gym, v_plan_b, 'active'::public.plan_sub_state,
     100, now() - interval '5 days')
  returning id into v_sub_b;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub_a',  v_sub_a::text,  true);
  perform set_config('test.sub_b',  v_sub_b::text,  true);
  perform set_config('test.sess',   v_sess::text,   true);
end $$;

-- 1. credits_first (default) — picks the credit-based plan (sub_a).
update public.gyms set subscription_resolution = 'credits_first'
  where id = current_setting('test.gym')::uuid;

do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select is(
  (
    select id::text from public.select_default_entitlement(
      current_setting('test.member')::uuid,
      current_setting('test.gym')::uuid,
      current_setting('test.sess')::uuid)
  ),
  current_setting('test.sub_a'),
  'credits_first picks the credit-based plan over the unlimited one'
);

-- 2. newest_first — picks the most recently created plan (sub_b).
do $$ begin reset role; end $$;
update public.gyms set subscription_resolution = 'newest_first'
  where id = current_setting('test.gym')::uuid;
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select is(
  (
    select id::text from public.select_default_entitlement(
      current_setting('test.member')::uuid,
      current_setting('test.gym')::uuid,
      current_setting('test.sess')::uuid)
  ),
  current_setting('test.sub_b'),
  'newest_first picks the most recently created plan'
);

-- 3. highest_priority — picks the highest-priority plan (sub_b at 100).
do $$ begin reset role; end $$;
update public.gyms set subscription_resolution = 'highest_priority'
  where id = current_setting('test.gym')::uuid;
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select is(
  (
    select id::text from public.select_default_entitlement(
      current_setting('test.member')::uuid,
      current_setting('test.gym')::uuid,
      current_setting('test.sess')::uuid)
  ),
  current_setting('test.sub_b'),
  'highest_priority picks the plan with the highest priority column'
);

-- 4. highest_priority — flip priorities and the pick flips.
do $$
begin
  reset role;
  update public.plan_subscriptions set priority = 200
    where id = current_setting('test.sub_a')::uuid;
  update public.plan_subscriptions set priority = 10
    where id = current_setting('test.sub_b')::uuid;
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

select is(
  (
    select id::text from public.select_default_entitlement(
      current_setting('test.member')::uuid,
      current_setting('test.gym')::uuid,
      current_setting('test.sess')::uuid)
  ),
  current_setting('test.sub_a'),
  'highest_priority flips when priority columns flip'
);

-- 5. Explicit choice via book_class is honoured (member picks sub_b
--    even though credits_first default would pick sub_a).
do $$
begin
  reset role;
  update public.gyms set subscription_resolution = 'credits_first'
    where id = current_setting('test.gym')::uuid;
  -- Reset priorities so default would pick sub_a again
  update public.plan_subscriptions set priority = 0
    where profile_id = current_setting('test.member')::uuid;
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

select lives_ok(
  format(
    'select book_class(%L::uuid, %L, %L::uuid)',
    current_setting('test.sess'),
    'plan_subscription',
    current_setting('test.sub_b')
  ),
  'book_class accepts an explicit entitlement choice'
);

-- 6. The booking row records the chosen entitlement.
select is(
  (
    select used_entitlement_id::text from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  current_setting('test.sub_b'),
  'the booking row persists the chosen plan_subscription id'
);

-- 7. The booking row records the booker (the member themselves).
select is(
  (
    select booked_by_profile_id::text from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  current_setting('test.member'),
  'booked_by_profile_id records who clicked book'
);

-- 8. An entitlement that doesn't belong to this member is refused.
do $$
declare
  v_other      uuid := _test_mk_user('other@subres.test');
  v_other_plan uuid;
  v_other_sub  uuid;
  v_other_gm   uuid;
  v_sess2      uuid;
begin
  reset role;
  v_other_gm := _test_mk_membership(
    current_setting('test.gym')::uuid, v_other, 'member');
  insert into public.membership_plans (gym_id, name, kind)
    values (current_setting('test.gym')::uuid, 'Other plan', 'unlimited')
    returning plan_id into v_other_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_other_gm, v_other, current_setting('test.gym')::uuid,
     v_other_plan, 'active'::public.plan_sub_state)
  returning id into v_other_sub;

  v_sess2 := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '3 days');

  perform set_config('test.other_sub', v_other_sub::text, true);
  perform set_config('test.sess2',     v_sess2::text,     true);
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

select throws_like(
  format(
    'select book_class(%L::uuid, %L, %L::uuid)',
    current_setting('test.sess2'),
    'plan_subscription',
    current_setting('test.other_sub')
  ),
  '%not eligible%',
  'book_class refuses an entitlement that belongs to another member'
);

select * from finish();
rollback;
