-- Store recurring (Phase 2): the recurring-product CHECK constraints, the
-- per-cycle settlement RPC (paid order + re-delivery, idempotent), revenue
-- inclusion, the staff subscriber list authorisation, and subscription RLS.

begin;
select plan(13);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@rec.test');
  v_admin  uuid := _test_mk_user('admin@rec.test');
  v_coach  uuid := _test_mk_user('coach@rec.test');
  v_member uuid := _test_mk_user('member@rec.test');
  v_other  uuid := _test_mk_user('other@rec.test');
  v_gym    uuid := _test_mk_gym('Rec Gym', 'rec-gym');
  v_prod   uuid;
  v_sub    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_admin,  'admin');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other,  'member');

  update public.gyms set store_enabled = true where id = v_gym;

  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring,
     recurring_interval, digital_asset_path)
    values (v_gym, 'Monthly programming', 'digital', 4000, false, true, 'month',
            v_gym::text || '/digital/prog.pdf')
    returning id into v_prod;

  insert into public.store_subscriptions
    (gym_id, profile_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, currency, interval, digital_asset_path, status,
     stripe_subscription_id)
    values (v_gym, v_member, v_prod, 'Monthly programming', 'digital', 4000,
            'GBP', 'month', v_gym::text || '/digital/prog.pdf', 'active',
            'sub_test')
    returning id into v_sub;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.sub',    v_sub::text,    true);
end $$;

-- 1-2. Recurring-product CHECK constraints.
select throws_ok(
  format($$ insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring)
    values (%L::uuid, 'Bad', 'digital', 1000, false, true) $$,
    current_setting('test.gym')),
  '23514', null,
  'a recurring product without an interval is rejected');

select throws_ok(
  format($$ insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring, recurring_interval)
    values (%L::uuid, 'Box', 'physical', 1000, false, true, 'month') $$,
    current_setting('test.gym')),
  '23514', null,
  'a recurring physical product is rejected (Phase 3)');

-- 3-5. First cycle: a paid order + a re-delivered file.
select is(
  (select newly_created from public._record_store_subscription_cycle(
     'sub_test', 'inv_1', 4000, now() + interval '1 month')),
  true,
  'the first invoice records a new cycle');

select is(
  (select count(*)::int from public.store_orders
   where subscription_id = current_setting('test.sub')::uuid),
  1,
  'the cycle creates one paid order');

select is(
  (select count(*)::int from public.store_digital_deliveries
   where profile_id = current_setting('test.member')::uuid),
  1,
  'the digital good is delivered for the cycle');

-- 6-7. Replaying the same invoice is a no-op.
select is(
  (select newly_created from public._record_store_subscription_cycle(
     'sub_test', 'inv_1', 4000, now() + interval '1 month')),
  false,
  'replaying the same invoice is idempotent');

select is(
  (select count(*)::int from public.store_orders
   where subscription_id = current_setting('test.sub')::uuid),
  1,
  'no duplicate order on replay');

-- 8-9. A second invoice re-delivers the file.
select is(
  (select newly_created from public._record_store_subscription_cycle(
     'sub_test', 'inv_2', 4000, now() + interval '2 months')),
  true,
  'the next invoice records another cycle');

select is(
  (select count(*)::int from public.store_digital_deliveries
   where profile_id = current_setting('test.member')::uuid),
  2,
  'each paid cycle re-delivers the file');

-- 10. Cycle orders flow into store revenue.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select is(
  (select gross_cents from public.store_revenue_summary(
     current_setting('test.gym')::uuid, current_date, current_date)
   where currency = 'GBP'),
  8000::bigint,
  'revenue counts both cycle orders');

-- 11. Staff subscriber list (admin has can_manage_store).
select is(
  (select count(*)::int from public.staff_store_subscriptions(
     current_setting('test.gym')::uuid)),
  1,
  'an admin sees the subscriber');

-- 12. A coach without can_manage_store is refused.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_ok(
  format($$ select public.staff_store_subscriptions(%L::uuid) $$,
    current_setting('test.gym')),
  null, 'Not allowed',
  'a coach cannot read the subscriber list');

-- 13. RLS: a member can't see another member's subscription.
do $$ begin perform _test_act_as(current_setting('test.other')::uuid); end $$;
select is(
  (select count(*)::int from public.store_subscriptions
   where id = current_setting('test.sub')::uuid),
  0,
  'a member cannot see another member''s subscription');

select * from finish();
rollback;
