-- store_products.category (0254): the aisle chips' column. Members see
-- it through list_store_products (recreated with the wider shape), a
-- product without one is still listed, the catalogue stays members-only,
-- and writing the column stays behind can_manage_store.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@aisles.test');
  v_member uuid := _test_mk_user('member@aisles.test');
  v_out    uuid := _test_mk_user('outsider@aisles.test');
  v_gym    uuid := _test_mk_gym('Aisles Gym', 'aisles-gym');
  v_kit    uuid;
  v_none   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, stock_quantity, category, created_by)
  values
    (v_gym, 'Forge tee', 'physical', 2500, false, null, 'Kit', v_owner)
  returning id into v_kit;
  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, stock_quantity, category, created_by)
  values
    (v_gym, 'Open gym pass', 'digital', 1500, false, null, null, v_owner)
  returning id into v_none;

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.owner',  v_owner::text,  false);
  perform set_config('test.kit',    v_kit::text,    false);
  perform set_config('test.none',   v_none::text,   false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.out',    v_out::text,    false);
end $$;

-- 1. A member sees the category through the catalogue RPC.
select _test_act_as(current_setting('test.member')::uuid);
select results_eq(
  $$select category from public.list_store_products(current_setting('test.gym')::uuid)
     where id = current_setting('test.kit')::uuid$$,
  $$select 'Kit'::text as category$$,
  'the member catalogue carries the category'
);

-- 2. A product with no category is still listed (it lives under All).
select results_eq(
  $$select count(*)::integer as n
      from public.list_store_products(current_setting('test.gym')::uuid)$$,
  $$select 2::integer as n$$,
  'a category-less product is still in the catalogue'
);

-- 3. The catalogue stays members-only.
select _test_act_as(current_setting('test.out')::uuid);
select throws_ok(
  $$select * from public.list_store_products(current_setting('test.gym')::uuid)$$,
  'Not a member of this gym',
  'an outsider is refused the catalogue'
);

-- 4. The owner can recategorise through plain RLS.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$update public.store_products
       set category = 'Apparel'
     where id = current_setting('test.kit')::uuid$$,
  'the owner can write the category'
);

-- 5. A plain member's write is silently filtered by RLS: the attempt
--    succeeds as a statement and changes nothing, which the catalogue
--    then proves.
select _test_act_as(current_setting('test.member')::uuid);
update public.store_products
   set category = 'Hacked'
 where id = current_setting('test.kit')::uuid;
select results_eq(
  $$select category from public.list_store_products(current_setting('test.gym')::uuid)
     where id = current_setting('test.kit')::uuid$$,
  $$select 'Apparel'::text as category$$,
  'a member write is filtered out — the owner''s category stands'
);

-- 6. anon holds no execute grant on the recreated function.
select ok(
  not has_function_privilege('anon', 'public.list_store_products(uuid)', 'execute'),
  'anon cannot execute list_store_products'
);

select * from finish();
rollback;
