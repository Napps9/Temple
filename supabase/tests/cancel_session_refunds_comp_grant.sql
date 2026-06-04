-- An active comp_grant takes precedence over a sub for refund. When a
-- member has both a credit-pack sub AND an active comp at the session's
-- time, the refund hits the comp_grant.credits_remaining — mirroring
-- the consume-comp-first order the booking flow uses.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@refundcomp.test');
  v_gym    uuid := _test_mk_gym('Refund Comp', 'refundcomp');
  v_member uuid := _test_mk_user('m@refundcomp.test');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_comp   uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  -- Member has a credit-pack sub *and* an active comp grant. Refund
  -- should hit the comp grant.
  insert into public.membership_plans (gym_id, name, kind, credit_count, period_length)
    values (v_gym, 'Ten-pack', 'credit_period', 10, interval '30 days')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 5)
  returning id into v_sub;

  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, credits_total, credits_remaining, granted_by)
  values
    (v_gym, v_member, now() - interval '1 day', now() + interval '30 days', 5, 3, v_owner)
  returning grant_id into v_comp;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');
  perform _test_mk_booking(v_sess, v_member);

  perform set_config('test.sub',  v_sub::text,  true);
  perform set_config('test.comp', v_comp::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_session(v_sess);
end;
$$;

select is(
  (select credits_remaining from public.comp_grants
    where grant_id = current_setting('test.comp')::uuid),
  4,
  'comp_grant.credits_remaining incremented (was 3, +1 for refund)'
);

select is(
  (select credit_balance from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  5,
  'sub credit_balance unchanged — comp took precedence'
);

select * from finish();
rollback;
