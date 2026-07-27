-- Forward monthly revenue is what the memberships already sold are worth
-- per month from here: each member's OWN price, not the plan's current
-- list price. That grandfathering invariant (0015) is the whole reason
-- plan_subscriptions.price_cents exists, so a price rise must not inflate
-- the projection for members who never took it.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@finfwd.test');
  v_gym    uuid := _test_mk_gym('Fin Forward', 'finfwd');
  v_start  date := date_trunc('month', current_date)::date;
  v_plan   uuid;
  v_pack   uuid;
  v_mid    uuid;
  v_member uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 5000)
    returning plan_id into v_plan;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
    values (v_gym, 'Ten pack', 'credit_pack', 10, 9000)
    returning plan_id into v_pack;

  -- Joined at the old price; price_cents is explicit so the snapshot
  -- trigger leaves it alone.
  v_member := _test_mk_user('old@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 3000);

  -- Joined without an explicit price: the trigger snapshots the plan's.
  v_member := _test_mk_user('new@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state);

  -- Leaving at period end: still worth a month.
  v_member := _test_mk_user('leaving@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_plan,
    'cancelled_at_period_end'::public.plan_sub_state, 2000);

  -- Gone, and lapsed: worth nothing.
  v_member := _test_mk_user('gone@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_plan, 'cancelled'::public.plan_sub_state, 5000);

  v_member := _test_mk_user('lapsed@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_plan, 'lapsed'::public.plan_sub_state, 5000);

  -- A credit pack is a one-off purchase, not recurring revenue.
  v_member := _test_mk_user('pack@finfwd.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_pack, 'active'::public.plan_sub_state, 9000);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.plan',  v_plan::text,  true);
  perform set_config('test.start', v_start::text, true);
  perform _test_act_as(v_owner);
end;
$$;

select is(
  (select forward_mrr_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  10000::bigint,
  'grandfathered 3000 + snapshotted 5000 + leaving 2000, pack and gone excluded'
);

select is(
  (select forward_count from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  3,
  'three memberships still worth something next month'
);

-- The invariant that matters: raising the plan price must not re-rate
-- anyone who already joined.
select lives_ok(
  $$ update public.membership_plans set monthly_price_cents = 99000
       where plan_id = current_setting('test.plan')::uuid $$,
  'the gym raises its list price'
);

select is(
  (select forward_mrr_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  10000::bigint,
  'the projection is unmoved — existing members keep their own price'
);

select * from finish();
rollback;
