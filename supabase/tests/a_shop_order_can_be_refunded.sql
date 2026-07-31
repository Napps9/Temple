-- Refunding a shop order (0225)
--
-- The Stripe half lives in refund-store-order; this is everything after
-- the money moves, which is the half Stripe knows nothing about: whether
-- the stock comes back, whether the download keeps working, and what the
-- month's takings say afterwards.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@shopref.test');
  v_buyer  uuid := _test_mk_user('buyer@shopref.test');
  v_gym    uuid := _test_mk_gym('Shop Gym', 'shop-refund-gym');
  v_hoodie uuid;
  v_guide  uuid;
  v_open   uuid;  -- paid, not shipped
  v_gone   uuid;  -- paid and shipped
  v_dl     uuid;  -- a digital order
  v_item   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_buyer, 'member');

  insert into public.gym_stripe_accounts (gym_id, stripe_account_id, connected_by)
  values (v_gym, 'acct_shopref', v_owner);

  insert into public.store_products
    (gym_id, created_by, name, kind, price_cents, track_inventory,
     stock_quantity, active)
  values (v_gym, v_owner, 'Hoodie', 'physical', 3500, true, 10, true)
  returning id into v_hoodie;

  insert into public.store_products
    (gym_id, created_by, name, kind, price_cents, track_inventory,
     stock_quantity, active, digital_asset_path)
  values (v_gym, v_owner, 'Technique guide', 'digital', 1200, false,
          null, true, 'guides/technique.pdf')
  returning id into v_guide;

  -- Two physical orders, one shipped and one not.
  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents, total_cents,
     currency, has_physical, stripe_payment_intent_id, paid_at)
  values (v_gym, v_buyer, 'paid', 7000, 0, 7000, 'GBP', true, 'pi_open', now())
  returning id into v_open;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values (v_open, v_gym, v_hoodie, 'Hoodie', 'physical', 3500, 2, 7000);

  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents, total_cents,
     currency, has_physical, stripe_payment_intent_id, paid_at, fulfilled_at)
  values (v_gym, v_buyer, 'fulfilled', 3500, 0, 3500, 'GBP', true, 'pi_gone',
          now(), now())
  returning id into v_gone;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values (v_gone, v_gym, v_hoodie, 'Hoodie', 'physical', 3500, 1, 3500);

  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents, total_cents,
     currency, has_physical, stripe_payment_intent_id, paid_at)
  values (v_gym, v_buyer, 'paid', 1200, 0, 1200, 'GBP', false, 'pi_dl', now())
  returning id into v_dl;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values (v_dl, v_gym, v_guide, 'Technique guide', 'digital', 1200, 1, 1200)
  returning id into v_item;

  insert into public.store_digital_deliveries
    (order_item_id, gym_id, product_id, profile_id, name_snapshot, asset_path)
  values (v_item, v_gym, v_guide, v_buyer, 'Technique guide',
          'guides/technique.pdf');

  -- Stock as it stands after two hoodies went out on the open order.
  update public.store_products set stock_quantity = 7 where id = v_hoodie;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.buyer',  v_buyer::text,  true);
  perform set_config('test.hoodie', v_hoodie::text, true);
  perform set_config('test.open',   v_open::text,   true);
  perform set_config('test.gone',   v_gone::text,   true);
  perform set_config('test.dl',     v_dl::text,     true);
end $$;

-- ---------------------------------------------------------------------------
-- Only the edge function may call it
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege(
    'authenticated', 'public._refund_store_order(uuid, integer, uuid)', 'execute'),
  'a client cannot mark an order refunded without refunding it'
);

-- ---------------------------------------------------------------------------
-- Nothing shipped: the stock comes back
-- ---------------------------------------------------------------------------

select lives_ok(
  format(
    'select public._refund_store_order(%L::uuid, 7000, %L::uuid)',
    current_setting('test.open'), current_setting('test.owner')
  ),
  'an unshipped order refunds'
);

select is(
  (select status::text from public.store_orders
     where id = current_setting('test.open')::uuid),
  'refunded',
  'and the order says so'
);

select is(
  (select stock_quantity from public.store_products
     where id = current_setting('test.hoodie')::uuid),
  9,
  'and both hoodies are back on the shelf'
);

select is(
  (select amount_cents from public.billing_events
     where provider_event_id = 'store_refund:' || current_setting('test.open')),
  7000,
  'the refund is recorded against the gym'
);

select is(
  (select kind from public.billing_events
     where provider_event_id = 'store_refund:' || current_setting('test.open')),
  'refund',
  'as a refund, which is not revenue'
);

select lives_ok(
  format(
    'select public._refund_store_order(%L::uuid, 7000, %L::uuid)',
    current_setting('test.open'), current_setting('test.owner')
  ),
  'refunding it twice is a no-op rather than an error'
);

select is(
  (select stock_quantity from public.store_products
     where id = current_setting('test.hoodie')::uuid),
  9,
  'and does not put the stock back twice'
);

-- ---------------------------------------------------------------------------
-- Already shipped: the stock does not
-- ---------------------------------------------------------------------------

select lives_ok(
  format(
    'select public._refund_store_order(%L::uuid, 3500, %L::uuid)',
    current_setting('test.gone'), current_setting('test.owner')
  ),
  'a shipped order refunds too'
);

select is(
  (select stock_quantity from public.store_products
     where id = current_setting('test.hoodie')::uuid),
  9,
  'but the hoodie you posted last week does not come back'
);

-- ---------------------------------------------------------------------------
-- A refunded download stops working
-- ---------------------------------------------------------------------------

select lives_ok(
  format(
    'select public._refund_store_order(%L::uuid, 1200, %L::uuid)',
    current_setting('test.dl'), current_setting('test.owner')
  ),
  'a digital order refunds'
);

select _test_act_as(current_setting('test.buyer')::uuid);

select is(
  (select count(*)::int from public.store_digital_deliveries
     where gym_id = current_setting('test.gym')::uuid),
  0,
  'and the buyer can no longer see the download'
);

select * from finish();
rollback;
