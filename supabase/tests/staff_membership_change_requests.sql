-- The staff queue RPC: only can_assign_plan staff may call it, and it
-- returns each pending request enriched with the member's name and the
-- current/target plan names.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@smcr.test');
  v_member  uuid := _test_mk_user('member@smcr.test');
  v_coach   uuid := _test_mk_user('coach@smcr.test');
  v_gym     uuid := _test_mk_gym('SMCR Gym', 'smcr-gym');
  v_basic   uuid;
  v_premium uuid;
  v_mem_id  uuid;
  v_sub     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_coach,  'coach');

  update public.profiles set full_name = 'Test Member' where id = v_member;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Basic', 'unlimited', 3000) returning plan_id into v_basic;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Premium', 'unlimited', 6000) returning plan_id into v_premium;

  select id into v_mem_id from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_mem_id, v_member, v_gym, v_basic, 'active')
    returning id into v_sub;

  insert into public.membership_change_requests
    (gym_id, profile_id, plan_subscription_id, kind, target_plan_id, member_note)
    values (v_gym, v_member, v_sub, 'switch_plan', v_premium, 'Want more classes');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.coach',  v_coach::text,  true);
end $$;

-- 1. Function exists.
select has_function(
  'public'::name, 'staff_membership_change_requests'::name,
  array['uuid']::name[], 'staff queue RPC exists');

-- 2. A plain member can't read the queue.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_ok(
  $q$ select public.staff_membership_change_requests(
        current_setting('test.gym')::uuid) $q$,
  null::text,
  'Not allowed',
  'a member cannot read the staff queue');

-- 3-6. A coach (can_assign_plan) gets the enriched pending row.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.staff_membership_change_requests(
     current_setting('test.gym')::uuid)),
  1, 'coach sees the one pending request');
select is(
  (select member_name from public.staff_membership_change_requests(
     current_setting('test.gym')::uuid) limit 1),
  'Test Member', 'request carries the member name');
select is(
  (select current_plan_name from public.staff_membership_change_requests(
     current_setting('test.gym')::uuid) limit 1),
  'Basic', 'request carries the current plan name');
select is(
  (select target_plan_name from public.staff_membership_change_requests(
     current_setting('test.gym')::uuid) limit 1),
  'Premium', 'request carries the target plan name');

select * from finish();
rollback;
