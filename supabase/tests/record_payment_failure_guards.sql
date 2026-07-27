-- _record_payment_failure exists because a plain UPDATE from the webhook
-- gets four things wrong. Each assertion below pins one of them.
--
-- Stripe does not guarantee webhook ORDER and redelivers freely, so every
-- one of these is a real sequence a live gym will hit, not a hypothetical.

begin;
select plan(25);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@failguard.test');
  v_gym    uuid := _test_mk_gym('Fail Guard', 'failguard');
  v_plan   uuid;
  v_mid    uuid;
  v_member uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;

  v_member := _test_mk_user('live@failguard.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     'sub_live');

  v_member := _test_mk_user('dead@failguard.test');
  v_mid    := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'cancelled'::public.plan_sub_state, 6000,
     'sub_dead');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
end;
$$;

-- 1. A manual invoice is not membership dunning.
select is(
  public._record_payment_failure('sub_live', 1, 'nope', null, null, 'manual',
    null),
  false,
  'a manual invoice does not mark the membership as failing'
);

select is(
  (select past_due_since from public.plan_subscriptions
    where stripe_subscription_id = 'sub_live'),
  null::timestamptz,
  'and leaves it genuinely untouched'
);

-- 2. A cancelled membership is dead, not in dunning. Stripe keeps
--    retrying an open invoice after cancellation, so this fires for real.
select is(
  public._record_payment_failure('sub_dead', 1, 'declined', null, null,
    'subscription_cycle', null),
  false,
  'a cancelled membership is not re-flagged by a late retry'
);

-- 3. The first real failure stamps the clock.
select is(
  public._record_payment_failure('sub_live', 1, 'Card declined',
    'https://invoice/1', now() + interval '3 days', 'subscription_cycle', null),
  true,
  'a subscription renewal failure is recorded'
);

select ok(
  (select past_due_since is not null and payment_failure_count = 1
     and last_payment_error = 'Card declined'
   from public.plan_subscriptions where stripe_subscription_id = 'sub_live'),
  'with the attempt count and the reason'
);

-- The pay-now link lands on its own self-only table, never on the
-- subscription row that every coach can read.
select is(
  (select l.invoice_url
     from public.membership_invoice_links l
     join public.plan_subscriptions ps on ps.id = l.plan_subscription_id
    where ps.stripe_subscription_id = 'sub_live'),
  'https://invoice/1',
  'and somewhere for the member to actually pay'
);

-- 4. A later attempt must not re-stamp the clock — "failing since" is the
--    start of the run, which is the number a gym chases on.
select lives_ok(
  $$ select set_config('test.first',
       (select past_due_since::text from public.plan_subscriptions
         where stripe_subscription_id = 'sub_live'), true) $$,
  'remember when it started'
);

select is(
  public._record_payment_failure('sub_live', 2, 'Card declined',
    'https://invoice/2', now() + interval '6 days', 'subscription_cycle', null),
  true,
  'a second failure lands'
);

select is(
  (select past_due_since from public.plan_subscriptions
    where stripe_subscription_id = 'sub_live'),
  current_setting('test.first')::timestamptz,
  'and leaves the start of the run alone'
);

-- 5. Webhooks arrive out of order. An older attempt must not walk the
--    counter backwards or rewind the retry date.
select is(
  public._record_payment_failure('sub_live', 1, 'Card declined',
    'https://invoice/1', now() + interval '99 days', 'subscription_cycle', null),
  true,
  'a re-delivered attempt 1 is accepted'
);

select is(
  (select payment_failure_count from public.plan_subscriptions
    where stripe_subscription_id = 'sub_live'),
  2,
  'but does not walk the counter back from attempt 2'
);

select ok(
  (select next_payment_attempt < now() + interval '10 days'
     from public.plan_subscriptions where stripe_subscription_id = 'sub_live'),
  'and does not rewind the retry date it carried'
);

-- Stripe stopping its retries is signalled by a null next attempt on a
-- NEWER attempt — that is what drives the urgent copy on both surfaces.
select is(
  public._record_payment_failure('sub_live', 4, 'Card declined',
    'https://invoice/4', null, 'subscription_cycle', null),
  true,
  'a newer attempt lands'
);

select ok(
  (select next_payment_attempt is null and payment_failure_count = 4
     from public.plan_subscriptions where stripe_subscription_id = 'sub_live'),
  'with no retry scheduled, which is how "Stripe has given up" is read'
);

-- Recovery clears the flags AND takes the pay-now link away, so nobody is
-- left staring at a button for an invoice they already settled.
select lives_ok(
  $$ select public._clear_payment_failure('sub_live', now()) $$,
  'the payment recovers'
);

select ok(
  (select past_due_since is null and payment_failure_count = 0
     and last_payment_error is null and next_payment_attempt is null
   from public.plan_subscriptions where stripe_subscription_id = 'sub_live'),
  'every flag clears together, not just the headline one'
);

select is(
  (select count(*)::int from public.membership_invoice_links l
     join public.plan_subscriptions ps on ps.id = l.plan_subscription_id
    where ps.stripe_subscription_id = 'sub_live'),
  0,
  'and the stale pay-now link is gone'
);

-- A payment_failed for a period already settled must be inert. Stripe
-- redelivers on any 5xx and does not order events, so this arrives for
-- real — and without the guard it puts a paid-up member back under a red
-- banner for up to a month.
select lives_ok(
  $$ update public.plan_subscriptions set paid_period_end = now() + interval '20 days'
       where stripe_subscription_id = 'sub_live' $$,
  'the renewal settles'
);

select is(
  public._record_payment_failure('sub_live', 2, 'Card declined',
    'https://invoice/2', now() + interval '3 days', 'subscription_cycle',
    now() + interval '20 days'),
  false,
  'a replayed failure for an already-paid period is ignored'
);

select is(
  (select past_due_since from public.plan_subscriptions
    where stripe_subscription_id = 'sub_live'),
  null::timestamptz,
  'the recovered member stays recovered'
);

-- The mirror guard: a stale "subscription is active" event must not wipe a
-- failure that happened after it. Stripe emits that update as the period
-- rolls, moments before the invoice for it fails.
select is(
  public._record_payment_failure('sub_live', 1, 'Card declined',
    'https://invoice/9', now() + interval '3 days', 'subscription_cycle', null),
  true,
  'a fresh failure is recorded'
);

select lives_ok(
  $$ select public._clear_payment_failure('sub_live', now() - interval '1 hour') $$,
  'a stale clearing event arrives late'
);

select ok(
  (select past_due_since is not null from public.plan_subscriptions
    where stripe_subscription_id = 'sub_live'),
  'and does not wipe the newer failure'
);

-- The write path is service-role only. A client reaching it could flag or
-- unflag any membership in any gym.
select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  $$ select public._record_payment_failure('sub_live', 1, 'x', null, null,
       'subscription_cycle', null) $$,
  '42501',
  null,
  'an authenticated user cannot reach the dunning write path'
);

select throws_ok(
  $$ select public._clear_payment_failure('sub_live', now()) $$,
  '42501',
  null,
  'nor the clearing path'
);

select * from finish();
rollback;
