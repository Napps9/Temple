-- The premise of the entire columns-not-status decision (0174): a member
-- whose card has bounced KEEPS TRAINING while Stripe retries.
--
-- If someone later adds a 'past_due' plan_sub_state and flips the row to
-- it, or teaches an eligibility predicate to read past_due_since, this
-- file fails — which is the point. Stripe's smart retries run about two
-- weeks and most recover; locking a member out on day one over an expired
-- card is worse than not knowing at all, and nothing else in the schema
-- records that intent.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@dunbook.test');
  v_member uuid := _test_mk_user('m@dunbook.test');
  v_gym    uuid := _test_mk_gym('Dun Book', 'dunbook');
  v_plan   uuid;
  v_mid    uuid;
  v_sub    uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;

  -- Active, and three days into a failing run.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end, stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     now() + interval '20 days', 'sub_dunning')
  returning id into v_sub;
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, last_payment_error)
  values (v_sub, v_member, v_gym, now() - interval '3 days', 2,
     'Card declined');

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');
  perform set_config('test.sess',   v_sess::text,   true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.gym',    v_gym::text,    true);
end;
$$;

select _test_act_as(current_setting('test.member')::uuid);

select ok(
  public.is_booking_eligible(
    current_setting('test.member')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.sess')::uuid),
  'a member mid-dunning is still eligible to book'
);

select lives_ok(
  $$ select public.book_class(current_setting('test.sess')::uuid) $$,
  'and the booking actually goes through'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.member')::uuid),
  1,
  'they are on the roster like anyone else'
);

select * from finish();
rollback;
