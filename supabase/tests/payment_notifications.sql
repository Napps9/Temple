-- Telling the member their payment failed: once per dunning run, not once
-- per retry, and unsent if they pay before the worker drains.

begin;
select plan(17);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@paynotif.test');
  v_member uuid := _test_mk_user('member@paynotif.test');
  v_gym    uuid := _test_mk_gym('Pay Notif', 'paynotif');
  v_plan   uuid;
  v_mid    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     'sub_notify');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.owner',  v_owner::text,  true);
end;
$$;

-- Attempt 1: the member is told, in-app instantly and by queued email.
select is(
  public._record_payment_failure('sub_notify', 1, 'Card declined',
    'https://invoice/n1', now() + interval '3 days', 'subscription_cycle', null),
  true,
  'the first failure is recorded'
);

select is(
  (select count(*)::int from public.payment_notifications
    where kind = 'payment_failed'),
  2,
  'one in-app row and one email row'
);

select is(
  (select status from public.payment_notifications
    where kind = 'payment_failed' and channel = 'in_app'),
  'sent',
  'the in-app half is delivered immediately — it IS the row'
);

select is(
  (select status from public.payment_notifications
    where kind = 'payment_failed' and channel = 'email'),
  'queued',
  'the email waits for the worker'
);

select ok(
  (select body from public.payment_notifications
    where kind = 'payment_failed' and channel = 'in_app')
    like '%classes are not affected%',
  'and says their classes are safe, because they are'
);

-- Attempts 2 and 3 are the SAME run. Stripe retries three or four times;
-- mailing each would train the member to ignore the sender.
select is(
  public._record_payment_failure('sub_notify', 2, 'Card declined',
    'https://invoice/n1', now() + interval '6 days', 'subscription_cycle', null),
  true,
  'Stripe retries and fails again'
);

select is(
  (select count(*)::int from public.payment_notifications
    where kind = 'payment_failed'),
  2,
  'the retry does not send a second notice'
);

-- Stripe delivers out of order often enough to matter. Attempt 1 arriving
-- after attempt 2 carries the older invoice's empty retry date; the update
-- discards it, so the notice must be decided off the row rather than off
-- the parameter, or a stale event mails "we have stopped trying" mid-run.
select is(
  public._record_payment_failure('sub_notify', 1, 'Card declined',
    'https://invoice/n1', null, 'subscription_cycle', null),
  true,
  'a stale attempt 1 arrives after attempt 2'
);

select is(
  (select count(*)::int from public.payment_notifications
    where kind = 'payment_final_notice'),
  0,
  'and does not trigger the final notice — attempt 2 is still scheduled'
);

-- Stripe giving up changes the consequence, so it earns its own message.
select is(
  public._record_payment_failure('sub_notify', 3, 'Card declined',
    'https://invoice/n1', null, 'subscription_cycle', null),
  true,
  'the last attempt fails with nothing scheduled'
);

select ok(
  (select body from public.payment_notifications
    where kind = 'payment_final_notice' and channel = 'in_app')
    like '%will be cancelled%',
  'a final notice goes out saying the membership will be cancelled'
);

-- Recovery inside the send window: the email must not go out, and the
-- badge must clear.
select lives_ok(
  $$ select public._clear_payment_failure('sub_notify', now()) $$,
  'the member pays before the worker drains'
);

select ok(
  not exists (
    select 1 from public.payment_notifications
    where status = 'queued'
  )
  and not exists (
    select 1 from public.payment_notifications
    where channel = 'in_app' and read_at is null
  ),
  'nothing is left to send, and nothing is left unread'
);

-- A LATER dunning run is a new run and must notify again. The key carries
-- past_due_since, which recovery cleared and the next failure re-stamps.
-- pgTAP runs in one transaction where now() never advances, so the new run
-- start is stamped by hand — what is under test is that a different run
-- start produces a fresh notice rather than colliding with the old key.
update public.plan_subscriptions
  set past_due_since = now() - interval '40 days'
  where stripe_subscription_id = 'sub_notify';

select is(
  public._record_payment_failure('sub_notify', 1, 'Card declined again',
    'https://invoice/n2', now() + interval '3 days', 'subscription_cycle', null),
  true,
  'the card fails again a month later'
);

select is(
  (select count(*)::int from public.payment_notifications
    where kind = 'payment_failed' and channel = 'email'),
  2,
  'a new run gets its own notice — silence would be worse the second time'
);

-- A gym with Stripe's retries turned off gets a first failure that is also
-- the last. Sending both kinds would mail "we'll try again" and "we have
-- stopped trying" in the same breath.
do $$
declare
  v_o uuid := _test_mk_user('o2@paynotif.test');
  v_m uuid := _test_mk_user('m2@paynotif.test');
  v_g uuid := _test_mk_gym('No Retry', 'noretry');
  v_p uuid; v_mid uuid;
begin
  perform _test_mk_membership(v_g, v_o, 'owner');
  v_mid := _test_mk_membership(v_g, v_m, 'member');
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_g, 'U', 'unlimited', 6000) returning plan_id into v_p;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_m, v_g, v_p, 'active'::public.plan_sub_state, 6000, 'sub_noretry');
  perform public._record_payment_failure('sub_noretry', 1, 'declined', null,
    null, 'subscription_cycle', null);
  perform set_config('test.noretry', v_g::text, true);
end;
$$;

select is(
  (select count(*)::int from public.payment_notifications
    where gym_id = current_setting('test.noretry')::uuid),
  2,
  'a first-and-final failure sends one notice, not two contradicting ones'
);

select is(
  (select distinct kind from public.payment_notifications
    where gym_id = current_setting('test.noretry')::uuid),
  'payment_final_notice',
  'and it is the one that tells them the membership is about to stop'
);

select * from finish();
rollback;
