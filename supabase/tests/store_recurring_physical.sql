-- Store recurring physical (Phase 3): recurring physical is now allowed, a
-- physical cycle mints a shippable order carrying the subscription's delivery
-- address (and no digital delivery), and update_store_subscription_shipping
-- is gated to the owner / managing staff and to box subscriptions only.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@recp.test');
  v_admin   uuid := _test_mk_user('admin@recp.test');
  v_member  uuid := _test_mk_user('member@recp.test');
  v_other   uuid := _test_mk_user('other@recp.test');
  v_gym     uuid := _test_mk_gym('Box Gym', 'box-gym');
  v_prod    uuid;
  v_sub     uuid;
  v_sub_dig uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_admin,  'admin');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other,  'member');
  update public.gyms set store_enabled = true where id = v_gym;

  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring, recurring_interval)
    values (v_gym, 'Monthly box', 'physical', 3500, false, true, 'month')
    returning id into v_prod;

  insert into public.store_subscriptions
    (gym_id, profile_id, product_id, name_snapshot, kind_snapshot, unit_price_cents,
     currency, "interval", status, stripe_subscription_id, shipping_name, shipping_address)
    values (v_gym, v_member, v_prod, 'Monthly box', 'physical', 3500, 'GBP', 'month',
            'active', 'sub_box', 'Sam Member',
            jsonb_build_object('line1', '1 High St', 'city', 'London',
                               'postal_code', 'SW1A 1AA', 'country', 'GB'))
    returning id into v_sub;

  -- A digital subscription for the same member, to prove the address RPC
  -- refuses a non-shipped subscription.
  insert into public.store_subscriptions
    (gym_id, profile_id, product_id, name_snapshot, kind_snapshot, unit_price_cents,
     currency, "interval", status, stripe_subscription_id)
    values (v_gym, v_member, v_prod, 'Programming', 'digital', 2000, 'GBP', 'month',
            'active', 'sub_dig')
    returning id into v_sub_dig;

  perform set_config('test.gym',    v_gym::text,     true);
  perform set_config('test.admin',  v_admin::text,   true);
  perform set_config('test.member', v_member::text,  true);
  perform set_config('test.other',  v_other::text,   true);
  perform set_config('test.sub',    v_sub::text,     true);
  perform set_config('test.subdig', v_sub_dig::text, true);
end $$;

-- 1. Recurring physical is allowed as of Phase 3 (the guard is dropped).
select lives_ok(
  format($$ insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring, recurring_interval)
    values (%L::uuid, 'Another box', 'physical', 2000, false, true, 'month') $$,
    current_setting('test.gym')),
  'a recurring physical product can be created');

-- 2-5. A physical cycle mints a shippable order with the delivery address
--      and no digital delivery (run as the service-role caller / superuser).
select is(
  (select newly_created from public._record_store_subscription_cycle(
     'sub_box', 'inv_b1', 3500, now() + interval '1 month')),
  true,
  'the first box invoice records a cycle');

select is(
  (select has_physical from public.store_orders
   where subscription_id = current_setting('test.sub')::uuid),
  true,
  'the cycle order is physical (lands in the fulfilment queue)');

select is(
  (select shipping_address->>'postal_code' from public.store_orders
   where subscription_id = current_setting('test.sub')::uuid),
  'SW1A 1AA',
  'the cycle order carries the subscription delivery address');

select is(
  (select count(*)::int from public.store_digital_deliveries
   where profile_id = current_setting('test.member')::uuid),
  0,
  'a box cycle creates no digital delivery');

-- 6-7. The member updates their own delivery address.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select lives_ok(
  format($$ select public.update_store_subscription_shipping(
    %L::uuid, 'Sam Member',
    jsonb_build_object('line1', '9 New Road', 'city', 'Leeds',
                       'postal_code', 'LS1 4DY', 'country', 'GB')) $$,
    current_setting('test.sub')),
  'the member can update their own delivery address');

select is(
  (select shipping_address->>'city' from public.store_subscriptions
   where id = current_setting('test.sub')::uuid),
  'Leeds',
  'the new address is saved (used from the next cycle)');

-- 8. A different member cannot touch it.
do $$ begin perform _test_act_as(current_setting('test.other')::uuid); end $$;
select throws_ok(
  format($$ select public.update_store_subscription_shipping(
    %L::uuid, 'Mallory', jsonb_build_object('line1', 'x')) $$,
    current_setting('test.sub')),
  null, 'Not allowed',
  'a non-owner cannot change the delivery address');

-- 9. A non-shipped (digital) subscription has no delivery address.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_ok(
  format($$ select public.update_store_subscription_shipping(
    %L::uuid, 'Sam', jsonb_build_object('line1', 'x')) $$,
    current_setting('test.subdig')),
  null, 'Only a shipped subscription has a delivery address',
  'a digital subscription rejects a delivery address');

select * from finish();
rollback;
