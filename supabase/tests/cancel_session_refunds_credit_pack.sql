-- A credit-pack member booked into a future class gets their credit back
-- on the plan_subscription when the owner cancels the class.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@refundsub.test');
  v_gym    uuid := _test_mk_gym('Refund Sub', 'refundsub');
  v_member uuid := _test_mk_user('m@refundsub.test');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count, period_length)
    values (v_gym, 'Ten-pack', 'credit_period', 10, interval '30 days')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 9)
  returning id into v_sub;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');
  perform _test_mk_booking(v_sess, v_member);

  perform set_config('test.sub',  v_sub::text,  true);
  perform set_config('test.sess', v_sess::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_session(v_sess);
end;
$$;

select is(
  (select credit_balance from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  10,
  'credit_balance incremented by 1 (was 9, +1 for refund)'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  0,
  'session row deleted'
);

select * from finish();
rollback;
