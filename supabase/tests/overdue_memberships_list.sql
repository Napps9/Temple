-- The chase list: who is failing, gated on money, and carrying no PII or
-- bearer link that would sidestep the gates governing those.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@chase.test');
  v_admin  uuid := _test_mk_user('admin@chase.test');
  v_gym    uuid := _test_mk_gym('Chase', 'chase');
  v_plan   uuid;
  v_mid    uuid;
  v_member uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;

  -- Failing, and still worth chasing.
  v_member := _test_mk_user('failing@chase.test');
  update public.profiles set full_name = 'Ada Failing' where id = v_member;
  v_mid := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     past_due_since, payment_failure_count)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 4200,
     now() - interval '5 days', 2);
  perform set_config('test.failing', v_member::text, true);
  insert into public.membership_invoice_links
    (plan_subscription_id, profile_id, gym_id, invoice_url)
  select id, v_member, v_gym, 'https://invoice/secret'
    from public.plan_subscriptions
    where profile_id = v_member and gym_id = v_gym;

  -- Failing but already cancelled: the money is gone, do not chase.
  v_member := _test_mk_user('gone@chase.test');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     past_due_since)
  values (v_mid, v_member, v_gym, v_plan, 'cancelled'::public.plan_sub_state, 6000,
     now() - interval '9 days');

  -- Healthy: never on the list.
  v_member := _test_mk_user('fine@chase.test');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 6000);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.admin', v_admin::text, true);
  perform _test_act_as(v_owner);
end;
$$;

select is(
  (select count(*)::int from public.gym_overdue_memberships(
     current_setting('test.gym')::uuid)),
  1,
  'only the live failing membership is listed'
);

select is(
  (select full_name from public.gym_overdue_memberships(
     current_setting('test.gym')::uuid)),
  'Ada Failing',
  'named, so there is someone to ring'
);

select is(
  (select amount_cents from public.gym_overdue_memberships(
     current_setting('test.gym')::uuid)),
  4200,
  'at the price that member actually pays'
);

select is(
  (select payment_failure_count from public.gym_overdue_memberships(
     current_setting('test.gym')::uuid)),
  2,
  'with the attempt count'
);

-- The hosted invoice link is a bearer URL rendering the member's billing
-- address, and coach/staff hold neither can_see_full_pii nor
-- can_see_email. It must not ride out on a money RPC, and it must not sit
-- on plan_subscriptions either — user_can_assign_plan (0008:189) lets
-- every coach read that row.
select ok(
  pg_get_function_result(
    (select p.oid from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'gym_overdue_memberships')
  ) not like '%invoice%',
  'the chase list does not expose the hosted invoice link'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_subscriptions'
      and column_name like '%invoice_url%'
  ),
  'and the link is not on the subscription row every coach can read'
);

-- RLS, not just the RPC shape: the link table has a self-only policy and
-- deliberately no staff policy at all.
select is(
  (select count(*)::int from public.membership_invoice_links),
  0,
  'the gym owner cannot read the member pay-now link'
);

select _test_act_as(current_setting('test.failing')::uuid);

select is(
  (select count(*)::int from public.membership_invoice_links),
  1,
  'but the member reads their own'
);

select _test_act_as(current_setting('test.admin')::uuid);

select is(
  (select count(*)::int from public.membership_invoice_links),
  0,
  'and an admin reads none'
);

select throws_ok(
  $$ select * from public.gym_overdue_memberships(
       current_setting('test.gym')::uuid) $$,
  'Not authorised',
  'an admin without can_see_money cannot read it'
);

select * from finish();
rollback;
