-- Adopt mode for the Stripe member import (0089):
--   * A staged pending member carrying a Stripe subscription + customer id,
--     once they sign up, gets a plan_subscription that adopts those live
--     ids (so the webhook + in-app manage act on the real subscription),
--     and the connected-account customer is cached in gym_stripe_customers.
--   * A plain CSV import (no Stripe ids) still creates a null-Stripe
--     subscription, unchanged from 0076.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@imp.test');
  v_member uuid := _test_mk_user('member@imp.test');
  v_gym    uuid := _test_mk_gym('Import Gym', 'imp-gym');
  v_plan   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Imported Unlimited', 'unlimited')
    returning plan_id into v_plan;

  -- Staged pre-signup with the live Stripe ids (the "adopt" import).
  insert into public.pending_members
    (gym_id, email, plan_name, plan_end, linked_membership_plan_id,
     imported_stripe_subscription_id, imported_stripe_customer_id,
     status, created_by)
    values (v_gym, 'member@imp.test', 'Imported Unlimited', '2030-01-01', v_plan,
            'sub_x', 'cus_x', 'pending', v_owner);

  -- Member signs up → gym_memberships insert fires apply_pending_member_data.
  perform _test_mk_membership(v_gym, v_member, 'member');
end $$;

select is(
  (select stripe_subscription_id from public.plan_subscriptions
     where profile_id = (select id from auth.users where email = 'member@imp.test')),
  'sub_x',
  'the plan_subscription adopts the live Stripe subscription id'
);
select is(
  (select stripe_customer_id from public.plan_subscriptions
     where profile_id = (select id from auth.users where email = 'member@imp.test')),
  'cus_x',
  'the plan_subscription carries the Stripe customer id'
);
select is(
  (select status::text from public.plan_subscriptions
     where profile_id = (select id from auth.users where email = 'member@imp.test')),
  'active',
  'the imported subscription is active'
);
select is(
  (select stripe_customer_id from public.gym_stripe_customers
     where profile_id = (select id from auth.users where email = 'member@imp.test')),
  'cus_x',
  'the connected-account customer is cached in gym_stripe_customers'
);

-- A CSV-style import (no Stripe ids) still works as before.
do $$
declare
  v_member2 uuid := _test_mk_user('csv@imp.test');
  v_gym     uuid := (select id from public.gyms where slug = 'imp-gym');
  v_plan    uuid := (select plan_id from public.membership_plans
                       where gym_id = (select id from public.gyms where slug = 'imp-gym')
                         and name = 'Imported Unlimited');
begin
  insert into public.pending_members
    (gym_id, email, plan_name, linked_membership_plan_id, status, created_by)
    values (v_gym, 'csv@imp.test', 'Imported Unlimited', v_plan, 'pending',
            (select id from auth.users where email = 'owner@imp.test'));
  perform _test_mk_membership(v_gym, v_member2, 'member');
end $$;

select is(
  (select stripe_subscription_id from public.plan_subscriptions
     where profile_id = (select id from auth.users where email = 'csv@imp.test')),
  null,
  'a CSV import (no Stripe ids) still creates a null-Stripe subscription'
);

select * from finish();
rollback;
