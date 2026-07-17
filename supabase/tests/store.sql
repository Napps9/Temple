-- Store: capability defaults, the payment-settlement RPC (stock decrement,
-- digital delivery, idempotency), member-vs-staff RLS, revenue + fulfilment
-- authorisation, and owner-only store settings.

begin;
select plan(21);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@store.test');
  v_admin  uuid := _test_mk_user('admin@store.test');
  v_coach  uuid := _test_mk_user('coach@store.test');
  v_member uuid := _test_mk_user('member@store.test');
  v_gym    uuid := _test_mk_gym('Store Gym', 'store-gym');
  v_phys   uuid;
  v_digi   uuid;
  v_order  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_admin,  'admin');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Fixtures written as the test superuser (RLS bypassed): the store is on,
  -- one tracked physical item (1 in stock) and one unlimited digital good,
  -- and a pending order for both awaiting its webhook.
  update public.gyms
    set store_enabled = true, store_shipping_fee_cents = 500
    where id = v_gym;

  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, stock_quantity)
    values (v_gym, 'Water bottle', 'physical', 1200, true, 1)
    returning id into v_phys;
  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, stock_quantity, digital_asset_path)
    values (v_gym, '12-week programme', 'digital', 4000, false, null,
            v_gym::text || '/digital/prog.pdf')
    returning id into v_digi;

  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents, total_cents,
     currency, has_physical, stripe_checkout_session_id)
    values (v_gym, v_member, 'pending', 5200, 500, 5700, 'GBP', true, 'sess_test')
    returning id into v_order;
  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values
    (v_order, v_gym, v_phys, 'Water bottle', 'physical', 1200, 1, 1200),
    (v_order, v_gym, v_digi, '12-week programme', 'digital', 4000, 1, 4000);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.phys',   v_phys::text,   true);
end $$;

-- 1-4. Capability defaults.
select is(public.default_capability('admin', 'can_manage_store'), true,
  'admin manages the store by default');
select is(public.default_capability('coach', 'can_manage_store'), false,
  'a coach does not manage the store by default');
select is(public.default_capability('admin', 'can_see_store_revenue'), true,
  'admin sees store revenue by default');
select is(public.default_capability('member', 'can_manage_store'), false,
  'a member never manages the store');

-- 5-8. Settlement (run as the superuser, standing in for the service role).
select is(
  (select newly_paid from public._mark_store_order_paid(
     'sess_test', 'pi_test', 5700, 'Jane Doe', '{"line1":"1 St"}'::jsonb)),
  true,
  'first settlement marks the order newly paid');

select is(
  (select status::text from public.store_orders
   where stripe_checkout_session_id = 'sess_test'),
  'paid',
  'the order is now paid');

select is(
  (select stock_quantity from public.store_products
   where id = current_setting('test.phys')::uuid),
  0,
  'the tracked item stock is decremented to zero');

select is(
  (select count(*)::int from public.store_digital_deliveries
   where profile_id = current_setting('test.member')::uuid),
  1,
  'the digital good grants exactly one delivery');

-- 9-11. Idempotency — a Stripe retry must not re-apply.
select is(
  (select newly_paid from public._mark_store_order_paid(
     'sess_test', 'pi_test', 5700, 'Jane Doe', '{"line1":"1 St"}'::jsonb)),
  false,
  'a repeat settlement reports not-newly-paid');

select is(
  (select stock_quantity from public.store_products
   where id = current_setting('test.phys')::uuid),
  0,
  'stock is not decremented twice');

select is(
  (select count(*)::int from public.store_digital_deliveries
   where profile_id = current_setting('test.member')::uuid),
  1,
  'no duplicate delivery on retry');

-- 12-15. Member view: no base-table read, but the catalogue RPC works and
-- the now-empty item reads as sold out.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select is(
  (select count(*)::int from public.store_products
   where gym_id = current_setting('test.gym')::uuid),
  0,
  'a member cannot read the products base table');

select is(
  (select count(*)::int from public.list_store_products(
     current_setting('test.gym')::uuid)),
  2,
  'a member sees the catalogue via list_store_products');

select is(
  (select sold_out from public.list_store_products(current_setting('test.gym')::uuid)
   where name = 'Water bottle'),
  true,
  'the depleted item reads as sold out');

select is(
  (select count(*)::int from public.store_orders
   where profile_id = current_setting('test.member')::uuid),
  1,
  'a member sees their own order');

-- 16-17. Staff revenue + fulfilment (admin has both by default).
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;

select is(
  (select gross_cents from public.store_revenue_summary(
     current_setting('test.gym')::uuid, current_date, current_date)
   where currency = 'GBP'),
  5700::bigint,
  'revenue summary totals the paid order');

select lives_ok(
  format($$ select public.fulfil_store_order(
    (select id from public.store_orders where stripe_checkout_session_id = 'sess_test'),
    'Royal Mail 123') $$),
  'an admin can fulfil a paid order');

-- 18. A coach without can_manage_store is refused the order queue.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select throws_ok(
  format($$ select public.staff_store_orders(%L::uuid) $$,
    current_setting('test.gym')),
  null,
  'Not allowed',
  'a coach cannot read the staff order queue');

-- 19-21. Product image galleries (0135). Admin manages the store, so the
-- gallery is written through the same RLS-gated update path staff use.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;

select is(
  (select image_urls from public.store_products
   where id = current_setting('test.phys')::uuid),
  '{}'::text[],
  'a product with no photos has an empty gallery by default');

update public.store_products
  set image_urls = array['https://img/a.jpg', 'https://img/b.jpg'],
      image_url  = 'https://img/a.jpg'
  where id = current_setting('test.phys')::uuid;

select is(
  (select image_urls from public.list_store_products(current_setting('test.gym')::uuid)
   where name = 'Water bottle'),
  array['https://img/a.jpg', 'https://img/b.jpg'],
  'the member catalogue returns the ordered image gallery');

select throws_ok(
  format($$ update public.store_products
    set image_urls = array['1','2','3','4','5','6','7','8','9']
    where id = %L::uuid $$, current_setting('test.phys')),
  '23514',
  null,
  'a gallery of more than 8 photos is rejected by the check constraint');

select * from finish();
rollback;
