-- A price, in the gym's money (0222)
--
-- The money job writes prose, and {offer_price} is substituted into the
-- email the member receives — so a sterling symbol here reaches further
-- than a screen. These check the formatter directly and then check that
-- the tick actually reads the gym's currency rather than a default.

begin;
select plan(11);

\ir _helpers.psql

-- ---------------------------------------------------------------------------
-- The formatter
-- ---------------------------------------------------------------------------

select is(public.money_text(8900, 'GBP'), '£89',
  'a whole amount in sterling drops the minor units');
select is(public.money_text(8950, 'GBP'), '£89.50',
  'a part amount keeps two places');
select is(public.money_text(8900, 'EUR'), '€89',
  'a euro gym gets a euro sign');
select is(public.money_text(8900, 'usd'), '$89',
  'the code is matched case-insensitively');
select is(public.money_text(8900, 'AUD'), 'A$89',
  'the dollars that are not US dollars say which they are');
select is(public.money_text(8900, 'CHF'), '89 CHF',
  'a currency with no symbol here still says which money it is');
select is(public.money_text(8900, null), '£89',
  'a gym with no currency set falls back rather than printing nothing');
select is(public.money_text(null, 'GBP'), '',
  'no price is empty, not a bare symbol');

-- ---------------------------------------------------------------------------
-- The tick uses it
-- ---------------------------------------------------------------------------

do $$
declare
  v_owner  uuid := _test_mk_user('owner@moneytext.test');
  v_member uuid := _test_mk_user('member@moneytext.test');
  v_gym    uuid := _test_mk_gym('Euro Box', 'euro-box');
  v_mship  uuid;
  v_plan   uuid;
  v_sub    uuid;
begin
  update public.gyms set currency = 'EUR' where id = v_gym;

  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mship := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Off-peak', 'unlimited', 5900);

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mship, v_member, v_gym, v_plan, 'active', 8900)
  returning id into v_sub;

  -- Stripe has given up: the tick proposes the cheaper plan, which is the
  -- branch that names a price twice.
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  values (v_sub, v_member, v_gym, now() - interval '9 days', 3, null);

  insert into public.agent_authority (gym_id, action_kind, level)
  values (v_gym, 'plan_adjustment_offer', 'approval');

  perform public.agent_revenue_tick();
end;
$$;

select is(
  (select a.payload->>'offer_price'
     from public.agent_actions a
     join public.gyms g on g.id = a.gym_id
     where g.slug = 'euro-box' and a.action_kind = 'plan_adjustment_offer'),
  '€59',
  'the offer names the cheaper plan in euros'
);

select ok(
  (select a.evidence::text like '%€89%'
     from public.agent_actions a
     join public.gyms g on g.id = a.gym_id
     where g.slug = 'euro-box' and a.action_kind = 'plan_adjustment_offer'),
  'the evidence says what they pay now in euros'
);

select ok(
  (select a.evidence::text not like '%£%'
     from public.agent_actions a
     join public.gyms g on g.id = a.gym_id
     where g.slug = 'euro-box' and a.action_kind = 'plan_adjustment_offer'),
  'and no sterling anywhere in it'
);

select * from finish();
rollback;
