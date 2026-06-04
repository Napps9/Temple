-- plan_subscriptions.price_cents is snapshotted on insert from the
-- parent plan. Subsequent edits to membership_plans.monthly_price_cents
-- never bleed back into the subscription.
--
-- Same shape covers credit_count → credit_balance: changing the plan's
-- credit_count doesn't retro-entitle existing subs.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@snap.test');
  v_gym   uuid := _test_mk_gym('Snap', 'snap');
  v_member uuid := _test_mk_user('m@snap.test');
  v_plan   uuid;
  v_mid    uuid;
  v_sub    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans
    (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
  values
    (v_gym, 'Ten-pack', 'credit_period', 10, interval '30 days', 5000)
  returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 10)
  returning id into v_sub;

  perform set_config('test.plan', v_plan::text, true);
  perform set_config('test.sub',  v_sub::text,  true);
end;
$$;

select is(
  (select price_cents from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  5000,
  'price_cents snapshotted at insert from plan.monthly_price_cents'
);

do $$
begin
  update public.membership_plans
    set monthly_price_cents = 9000, credit_count = 20
    where plan_id = current_setting('test.plan')::uuid;
end;
$$;

select is(
  (select price_cents from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  5000,
  'price_cents unchanged after plan price edit (grandfathered)'
);

select is(
  (select credit_balance from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  10,
  'credit_balance unchanged after plan credit_count edit'
);

select is(
  (select monthly_price_cents from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid),
  9000,
  'sanity: plan.monthly_price_cents reflects the edit'
);

select * from finish();
rollback;
