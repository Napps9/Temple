-- Pending is the money Stripe will TRY to take before the month is out:
-- recurring memberships whose paid_period_end falls after now and before
-- the month rolls over.
--
-- The window under test is next month, deliberately — it is wholly in the
-- future whatever day this test runs on, so "renews later this month"
-- always has room. Running it against the current month would be flaky on
-- the last day of a month.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@finpend.test');
  v_gym     uuid := _test_mk_gym('Fin Pending', 'finpend');
  v_start   date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_plan    uuid;
  v_pack    uuid;
  v_mid     uuid;
  v_member  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
    values (v_gym, 'Ten pack', 'credit_pack', 10, 9000)
    returning plan_id into v_pack;

  -- Renews inside the window: counts.
  v_member := _test_mk_user('due@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     v_start::timestamptz + interval '10 days');

  -- Renews the month after: does not count.
  v_member := _test_mk_user('later@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     v_start::timestamptz + interval '40 days');

  -- Already renewed — paid_period_end in the past: does not count.
  v_member := _test_mk_user('past@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     now() - interval '2 days');

  -- A credit pack renewing in the window: never counts, it does not renew.
  v_member := _test_mk_user('pack@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_pack, 'active'::public.plan_sub_state, 9000,
     v_start::timestamptz + interval '5 days');

  -- Cancelling at period end still bills once more: counts.
  v_member := _test_mk_user('leaving@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan,
     'cancelled_at_period_end'::public.plan_sub_state, 4500,
     v_start::timestamptz + interval '12 days');

  -- Gone: never counts.
  v_member := _test_mk_user('gone@finpend.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'cancelled'::public.plan_sub_state, 6000,
     v_start::timestamptz + interval '8 days');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform _test_act_as(v_owner);
end;
$$;

select is(
  (select pending_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  10500::bigint,
  'only the two renewing inside the window (6000 + 4500)'
);

select is(
  (select pending_count from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  2,
  'counted the same way'
);

select is(
  (select confirmed_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  0::bigint,
  'pending is not confirmed — nothing has been collected'
);

-- A gym with no settled events still gets its row, otherwise pending and
-- forward would vanish before the first sale.
select is(
  (select currency from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  'GBP',
  'the row exists on the gym currency with no billing events at all'
);

select * from finish();
rollback;
