-- Who can see that a member's card is failing, and what is left behind when
-- they leave.
--
-- 0174 put the decline reason on plan_subscriptions, whose staff policy is
-- user_can_assign_plan (0008:189) — every coach, no capability term. These
-- assertions are the ones that were quietly false for two commits.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@dunpriv.test');
  v_coach  uuid := _test_mk_user('coach@dunpriv.test');
  v_member uuid := _test_mk_user('member@dunpriv.test');
  v_gym    uuid := _test_mk_gym('Dun Priv', 'dunpriv');
  v_plan   uuid;
  v_mid    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     'sub_priv');

  perform public._record_payment_failure('sub_priv', 1,
    'Your card has insufficient funds', 'https://invoice/priv',
    now() + interval '3 days', 'subscription_cycle', null);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
end;
$$;

-- The columns are gone from the row every coach can read. Asserted on the
-- catalogue rather than on a select, so re-adding one fails here.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_subscriptions'
      and column_name in ('past_due_since', 'payment_failure_count',
                          'last_payment_error', 'next_payment_attempt')),
  0,
  'no dunning state on the table user_can_assign_plan admits'
);

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.plan_subscription_dunning),
  0,
  'a coach cannot read that a member is failing'
);

select throws_ok(
  $$ select public.gym_overdue_memberships(current_setting('test.gym')::uuid) $$,
  'Not authorised',
  'nor reach the chase list'
);

select _test_act_as(current_setting('test.member')::uuid);

select is(
  (select last_payment_error from public.plan_subscription_dunning),
  'Your card has insufficient funds',
  'the member sees their own decline reason'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.plan_subscription_dunning),
  1,
  'the owner, who can see money, sees it'
);

-- Leaving must take the payment trail with it. The invoice link is the
-- urgent one: a bearer URL to a Stripe page rendering the member's billing
-- name and address, on a member who is never coming back to pay.
select lives_ok(
  format(
    $$ select public.leave_gym(%L::uuid, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'the member quits instead of paying'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.plan_subscription_dunning),
  0,
  'the dunning state goes with them'
);

select is(
  (select count(*)::int from public.payment_notifications),
  0,
  'and the notices about their money'
);

-- Read as the table owner: the link has no staff policy at all, so an
-- authenticated select would return 0 whether or not the row survived.
select lives_ok(
  $$ select set_config('role', 'postgres', true) $$,
  'step out of RLS to check the link is really gone, not merely hidden'
);

select is(
  (select count(*)::int from public.membership_invoice_links),
  0,
  'the bearer link to their billing address is deleted, not orphaned'
);

select * from finish();
rollback;
