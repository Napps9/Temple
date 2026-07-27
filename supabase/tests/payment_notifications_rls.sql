-- Who can read a member's payment trouble: the member, and staff who can
-- see money. Not every coach — "this member's card is failing" is a money
-- fact, and the chase list already draws that line.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@paynrls.test');
  v_coach  uuid := _test_mk_user('coach@paynrls.test');
  v_member uuid := _test_mk_user('member@paynrls.test');
  v_other  uuid := _test_mk_user('other@paynrls.test');
  v_gym    uuid := _test_mk_gym('Pay RLS', 'paynrls');
  v_plan   uuid;
  v_mid    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_other,  'member');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     stripe_subscription_id)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000,
     'sub_rls');

  perform public._record_payment_failure('sub_rls', 1, 'Card declined',
    null, now() + interval '3 days', 'subscription_cycle', null);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
end;
$$;

select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select count(*)::int from public.payment_notifications),
  2,
  'the member sees their own notices'
);

select _test_act_as(current_setting('test.other')::uuid);
select is(
  (select count(*)::int from public.payment_notifications),
  0,
  'another member sees nothing'
);

select _test_act_as(current_setting('test.coach')::uuid);
select is(
  (select count(*)::int from public.payment_notifications),
  0,
  'a coach sees nothing — this is a money fact, not a roster one'
);

select _test_act_as(current_setting('test.owner')::uuid);
select is(
  (select count(*)::int from public.payment_notifications),
  2,
  'the owner, who can see money, sees them'
);

-- can_see_money and can_see_email are different keys. The owner can read
-- these rows, so the member's address must not be on one — the worker
-- resolves it under the service role, as 0174 did for the Pay-now link.
select is(
  (select recipient from public.payment_notifications where channel = 'email'),
  null,
  'and not the member email address, which is a separate capability'
);

-- Clearing the badge is the recipient's to do. An owner who can read the
-- notice marking it read would silence a member who never saw it.
select lives_ok(
  format(
    $$ select public.mark_payment_notifications_read(%L::uuid) $$,
    current_setting('test.gym')
  ),
  'the owner marks read'
);

select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select count(*)::int from public.payment_notifications
    where channel = 'in_app' and read_at is null),
  1,
  'but only their own rows, so the member still has theirs unread'
);

select lives_ok(
  format(
    $$ select public.mark_payment_notifications_read(%L::uuid) $$,
    current_setting('test.gym')
  ),
  'and the member clearing it does clear it'
);

select is(
  (select count(*)::int from public.payment_notifications
    where channel = 'in_app' and read_at is null),
  0,
  'the badge goes when the person it was for has seen it'
);

select * from finish();
rollback;
