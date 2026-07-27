-- A renewal whose card has already been declined must not sit in Pending
-- looking healthy — that was the hole 0173 shipped with and named in its
-- own header. It moves to At risk, and the two never overlap.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@finrisk.test');
  v_gym    uuid := _test_mk_gym('Fin Risk', 'finrisk');
  v_start  date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_plan   uuid;
  v_mid    uuid;
  v_sub    uuid;
  v_member uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;

  -- Healthy, renewing inside the window.
  v_member := _test_mk_user('ok@finrisk.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     v_start::timestamptz + interval '10 days');

  -- Failing, renewing inside the same window.
  v_member := _test_mk_user('bounced@finrisk.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end, stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 4000,
     v_start::timestamptz + interval '12 days', 'sub_recover')
  returning id into v_sub;
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count)
  values (v_sub, v_member, v_gym, now() - interval '3 days', 2);

  -- Failing, but NOT renewing inside the window: still at risk. At risk is
  -- about the state of the payment, not about when the next one is due.
  v_member := _test_mk_user('bouncedlater@finrisk.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 1500,
     v_start::timestamptz + interval '60 days')
  returning id into v_sub;
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count)
  values (v_sub, v_member, v_gym, now() - interval '1 day', 1);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform _test_act_as(v_owner);
end;
$$;

select is(
  (select pending_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  6000::bigint,
  'pending holds only the healthy renewal'
);

select is(
  (select pending_count from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  1,
  'the bounced one is not counted as pending'
);

select is(
  (select at_risk_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  5500::bigint,
  'at risk holds both failing memberships (4000 + 1500)'
);

select is(
  (select at_risk_count from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  2,
  'including the one whose renewal is outside the window'
);

-- Forward MRR is what the memberships are WORTH; a failing card does not
-- change the price, only the odds of collecting it.
select is(
  (select forward_mrr_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  11500::bigint,
  'forward revenue still counts all three'
);

-- Recovery: dropping the dunning row puts the money straight back.
-- Simulated with a DELETE rather than _clear_payment_failure, which is
-- service-role only while this block runs as the owner — and the owner has
-- no write policy on the dunning table, which is the point of 0176. So step
-- out of RLS for the one statement and step straight back in.
-- record_payment_failure_guards.sql exercises the real function, including
-- asserting that an authenticated caller is refused.
select lives_ok(
  $$ select set_config('role', 'postgres', true) $$,
  'the payments recover'
);
delete from public.plan_subscription_dunning
  where gym_id = current_setting('test.gym')::uuid;
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select at_risk_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  0::bigint,
  'and nothing is left at risk'
);

-- The other half of recovery, which the first draft never asserted: the
-- money has to come BACK to pending, not just leave at-risk.
select is(
  (select pending_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  10000::bigint,
  'the recovered renewal returns to pending (6000 + 4000)'
);

select * from finish();
rollback;
