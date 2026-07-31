-- Grants that guard nothing (0240).
--
-- `revoke ... from public` reads like a lockdown and is not one on
-- Supabase: default privileges have already granted anon and
-- authenticated explicitly, and revoking PUBLIC removes a grant that was
-- never what let them in. 0085 wrote it that way over the function that
-- settles a store order.
--
-- The first assertion is the money: a member cannot mark their own unpaid
-- order paid. The last is the family, keyed on the name rather than on a
-- list of thirteen, because a list is how the other eleven were correct
-- and these two were not for a hundred and fifty migrations.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@grants.test');
  v_buyer uuid := _test_mk_user('buyer@grants.test');
  v_gym   uuid := _test_mk_gym('Grants Gym', 'grants-gym');
  v_prod  uuid;
  v_order uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_buyer, 'member');

  insert into public.store_products
    (gym_id, name, kind, price_cents, digital_asset_path, track_inventory, active)
    values (v_gym, 'Programme PDF', 'digital', 4900,
            'gyms/grants/programme.pdf', false, true)
    returning id into v_prod;

  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, total_cents, currency,
     stripe_checkout_session_id)
    values (v_gym, v_buyer, 'pending', 4900, 4900, 'GBP', 'cs_test_NEVERPAID')
    returning id into v_order;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
    values (v_order, v_gym, v_prod, 'Programme PDF', 'digital', 4900, 1, 4900);

  perform set_config('test.buyer', v_buyer::text, true);
  perform set_config('test.order', v_order::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- The member who did not pay
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.buyer')::uuid);

-- They need the session id to try, and store_orders_select hands it to
-- them: it is their own order. That is correct and is not what is being
-- fixed — the point is that knowing it must not be enough.
select isnt(
  (select stripe_checkout_session_id from public.store_orders
     where id = current_setting('test.order')::uuid),
  null,
  'a buyer can read the checkout session id off their own order'
);

select throws_ok(
  $$ select public._mark_store_order_paid(
       'cs_test_NEVERPAID', 'pi_fake', 4900, null, null) $$,
  '42501',
  null,
  'and cannot settle it with that id'
);

select is(
  (select status::text from public.store_orders
     where id = current_setting('test.order')::uuid),
  'pending',
  'the order is still unpaid'
);

select is(
  (select count(*) from public.store_digital_deliveries
     where gym_id = (select gym_id from public.store_orders
                       where id = current_setting('test.order')::uuid)),
  0::bigint,
  'and the file was never granted'
);

-- ---------------------------------------------------------------------------
-- The family
-- ---------------------------------------------------------------------------
--
-- Every `_`-prefixed security-definer function in public is internal by
-- this codebase's convention: it trusts its caller because its caller is
-- the service role. Extension members are excluded so real pgTAP's own
-- internals do not count in CI, and `_tap_%` so the local harness's shim
-- does not count here.

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and p.proname like '\_%'
      and p.proname not like '\_tap\_%'
      and p.prorettype <> 'trigger'::regtype
      and not exists (
        select 1 from pg_depend d
         where d.objid = p.oid and d.deptype = 'e'
      )
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  '',
  'no internal helper is reachable by anon or authenticated'
);

select finish();
rollback;
