-- store_product_variants (0256): a variant order line spends the
-- variant's stock and never the product's, a refund puts it back on the
-- same shelf, the catalogue embeds variants with per-variant sold_out,
-- the product-level flag flips only when every variant is gone, and the
-- table stays staff-only. Settlement and refund run in the setup block
-- (they are service-role functions; captured values are asserted after)
-- because RESET ROLE after _test_act_as is unreliable — see CLAUDE.md.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@sizes.test');
  v_member uuid := _test_mk_user('member@sizes.test');
  v_gym    uuid := _test_mk_gym('Sizes Gym', 'sizes-gym');
  v_kit    uuid;
  v_s      uuid;
  v_order  uuid;
  v_tmp    integer;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Product-level tracking on AND variants present: the mixed state the
  -- "variant lines never touch product stock" rule exists to protect.
  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, stock_quantity, created_by)
  values
    (v_gym, 'Forge tee', 'physical', 2500, true, 50, v_owner)
  returning id into v_kit;

  insert into public.store_product_variants (product_id, gym_id, name, sort_order, stock_quantity)
  values (v_kit, v_gym, 'S', 1, 5)
  returning id into v_s;
  insert into public.store_product_variants (product_id, gym_id, name, sort_order, stock_quantity)
  values (v_kit, v_gym, 'M', 2, 0),
         (v_kit, v_gym, 'L', 3, null);

  -- A paid order for two S tees, then its refund.
  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents, total_cents,
     currency, has_physical, stripe_checkout_session_id)
  values
    (v_gym, v_member, 'pending', 5000, 0, 5000, 'GBP', true, 'sess_sizes_1')
  returning id into v_order;
  insert into public.store_order_items
    (order_id, gym_id, product_id, variant_id, variant_snapshot,
     name_snapshot, kind_snapshot, unit_price_cents, quantity, line_total_cents)
  values
    (v_order, v_gym, v_kit, v_s, 'S', 'Forge tee', 'physical', 2500, 2, 5000);

  perform 1 from public._mark_store_order_paid('sess_sizes_1', 'pi_sizes_1', 5000, null, null);
  select stock_quantity into v_tmp from public.store_product_variants where id = v_s;
  perform set_config('test.s_after_pay', v_tmp::text, false);
  select stock_quantity into v_tmp from public.store_products where id = v_kit;
  perform set_config('test.p_after_pay', v_tmp::text, false);

  perform public._refund_store_order(v_order, 5000, v_owner);
  select stock_quantity into v_tmp from public.store_product_variants where id = v_s;
  perform set_config('test.s_after_refund', v_tmp::text, false);

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.owner',  v_owner::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.kit',    v_kit::text,    false);
end $$;

-- 1. Settlement spent the S shelf: 5 - 2 = 3.
select results_eq(
  $$select current_setting('test.s_after_pay')::integer as n$$,
  $$select 3::integer as n$$,
  'paying a variant line decrements that variant''s stock'
);

-- 2. The product's own tracked count never moved.
select results_eq(
  $$select current_setting('test.p_after_pay')::integer as n$$,
  $$select 50::integer as n$$,
  'a variant line leaves product-level stock alone'
);

-- 3. The refund put both tees back on the S shelf.
select results_eq(
  $$select current_setting('test.s_after_refund')::integer as n$$,
  $$select 5::integer as n$$,
  'refunding an unfulfilled order restocks the variant'
);

-- 4. The member catalogue embeds all three variants.
select _test_act_as(current_setting('test.member')::uuid);
select results_eq(
  $$select jsonb_array_length(variants)::integer as n
      from public.list_store_products(current_setting('test.gym')::uuid)
     where id = current_setting('test.kit')::uuid$$,
  $$select 3::integer as n$$,
  'the catalogue carries the variants'
);

-- 5. Per-variant sold_out: only M (stock 0) reads sold out.
select results_eq(
  $$select jsonb_agg(v->>'name') as gone
      from public.list_store_products(current_setting('test.gym')::uuid) p,
           jsonb_array_elements(p.variants) v
     where p.id = current_setting('test.kit')::uuid
       and (v->>'sold_out')::boolean$$,
  $$select jsonb_build_array('M') as gone$$,
  'a zero-stock variant reads sold out; tracked-with-stock and untracked do not'
);

-- 6. The product stays available while any variant is buyable.
select results_eq(
  $$select sold_out from public.list_store_products(current_setting('test.gym')::uuid)
     where id = current_setting('test.kit')::uuid$$,
  $$select false as sold_out$$,
  'the product is not sold out while a variant remains'
);

-- 7. Staff manage variants through plain RLS.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$insert into public.store_product_variants (product_id, gym_id, name, sort_order, stock_quantity)
    values (current_setting('test.kit')::uuid, current_setting('test.gym')::uuid, 'XL', 4, 3)$$,
  'the owner can add a variant'
);

-- 8. ...including emptying every shelf.
select lives_ok(
  $$update public.store_product_variants
       set stock_quantity = 0
     where product_id = current_setting('test.kit')::uuid$$,
  'the owner can zero every variant'
);

-- 9. With every variant tracked and at zero, the product reads sold out.
select _test_act_as(current_setting('test.member')::uuid);
select results_eq(
  $$select sold_out from public.list_store_products(current_setting('test.gym')::uuid)
     where id = current_setting('test.kit')::uuid$$,
  $$select true as sold_out$$,
  'all variants gone flips the product to sold out'
);

-- 10. A member cannot write the variants table.
select throws_ok(
  $$insert into public.store_product_variants (product_id, gym_id, name)
    values (current_setting('test.kit')::uuid, current_setting('test.gym')::uuid, 'Hacked')$$,
  'new row violates row-level security policy for table "store_product_variants"',
  'a member insert is refused by RLS'
);

select * from finish();
rollback;
