-- An unlimited-plan member loses no credits at booking time (they're on
-- an all-you-can-eat plan), so cancellation refunds nothing — credit_balance
-- is null and stays null. Just confirming the inference handles this branch
-- cleanly rather than incrementing a null.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@refundunl.test');
  v_gym    uuid := _test_mk_gym('Refund Unl', 'refundunl');
  v_member uuid := _test_mk_user('m@refundunl.test');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state)
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
  null,
  'unlimited sub credit_balance still null after cancel'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  0,
  'session row deleted regardless'
);

select * from finish();
rollback;
