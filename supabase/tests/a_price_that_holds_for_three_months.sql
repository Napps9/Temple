-- Plan coupons (0264). preview_plan_coupon is the single place that
-- decides whether a code applies — the member's screen and
-- stripe-checkout both call it — so every refusal it can give is
-- asserted here, along with the two rules that are easiest to get
-- backwards: an empty plan list means EVERY plan, and the money fields
-- freeze once Stripe has seen them.

begin;
select plan(27);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@coupon.test');
  v_admin  uuid := _test_mk_user('admin@coupon.test');
  v_member uuid := _test_mk_user('member@coupon.test');
  v_out    uuid := _test_mk_user('outsider@coupon.test');
  v_gym    uuid := _test_mk_gym('Coupon Gym', 'coupon-gym');
  v_other  uuid := _test_mk_gym('Other Coupon Gym', 'other-coupon-gym');
  v_plan   uuid;
  v_plan2  uuid;
  v_far    uuid;
  v_striped uuid;
  v_pack    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_other, v_out, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 6000) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Off-peak', 'unlimited', 4000) returning plan_id into v_plan2;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_other, 'Elsewhere', 'unlimited', 5000) returning plan_id into v_far;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_gym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_pack;

  -- A coupon Stripe already holds, for the freeze assertions. Inserted
  -- here rather than through the RPC because only the webhook's service
  -- role ever writes stripe_coupon_id.
  insert into public.plan_coupons
    (gym_id, code, discount_kind, percent_off, created_by, stripe_coupon_id)
  values (v_gym, 'STRIPED', 'percent', 20, v_owner, 'co_test')
  returning id into v_striped;

  perform set_config('test.striped', v_striped::text, false);
  perform set_config('test.pack',    v_pack::text,    false);
  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.owner',  v_owner::text,  false);
  perform set_config('test.admin',  v_admin::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.out',    v_out::text,    false);
  perform set_config('test.plan',   v_plan::text,   false);
  perform set_config('test.plan2',  v_plan2::text,  false);
  perform set_config('test.far',    v_far::text,    false);
end $$;

-- 1. The webhook's writer is idempotent per checkout session — Stripe
--    retries, and a retry must not count a second redemption. Run as
--    the fixture role, because nothing a client can call may write here.
do $$
begin
  perform public._apply_plan_coupon(
    current_setting('test.striped')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.member')::uuid,
    current_setting('test.plan')::uuid,
    'cs_test_1', 'sub_test_1');
  perform public._apply_plan_coupon(
    current_setting('test.striped')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.member')::uuid,
    current_setting('test.plan')::uuid,
    'cs_test_1', 'sub_test_1');
end $$;
select is(
  (select count(*)::int from public.plan_coupon_redemptions
    where stripe_checkout_session_id = 'cs_test_1'),
  1,
  'a repeated webhook records one redemption, not two'
);
-- And that redemption is what the per-member limit counts.
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'STRIPED')),
  'You''ve already used that code',
  'a member who has used a code cannot use it again'
);

-- 2. The owner writes an offer; a plan list is optional.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'jan50', 'percent',
      null, 'January half price', 50)$$,
  'an owner can write a coupon'
);

-- 2. Empty plan list means EVERY plan, not none.
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'JAN50')),
  null,
  'a coupon with no plan list applies to any plan'
);
select is(
  (select discounted_first_cents from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'JAN50')),
  3000,
  'and the previewed price is the discounted one'
);

-- 3. The code is normalised: spaces and case do not matter.
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, '  jan 50 ')),
  null,
  'the code is matched case- and space-insensitively'
);

-- 4. An unknown code is vague on purpose, and another gym's code looks
--    exactly the same as an unknown one.
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'NOPE')),
  'That code isn''t recognised',
  'an unknown code is refused without saying more'
);

-- 5. A window that has not opened, and one that has closed.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'later', 'percent',
      null, null, 25, null, 'once', null, now() + interval '5 days')$$,
  'an owner can post-date a coupon'
);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'gone', 'percent',
      null, null, 25, null, 'once',
      null, now() - interval '10 days', now() - interval '1 day')$$,
  'and can write one that has already ended'
);
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'LATER')),
  'That code isn''t active yet',
  'a code before its window is refused'
);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'GONE')),
  'That code has expired',
  'a code past its window is refused'
);

-- 6. A plan list that excludes this plan.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'offpeak', 'percent',
      null, null, 20, null, 'once', null, null, null, null, 1,
      array[current_setting('test.plan2')::uuid])$$,
  'an owner can restrict a coupon to chosen plans'
);
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'OFFPEAK')),
  'That code doesn''t apply to this plan',
  'a restricted coupon is refused on a plan outside its list'
);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan2')::uuid, 'OFFPEAK')),
  null,
  'and applies on a plan inside it'
);

-- 7. A plan from another gym cannot be attached.
select _test_act_as(current_setting('test.owner')::uuid);
select throws_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'crossgym', 'percent',
      null, null, 10, null, 'once', null, null, null, null, 1,
      array[current_setting('test.far')::uuid])$$,
  'Plan belongs to another gym',
  'a plan from another gym is refused'
);

-- 8. The money fields freeze once Stripe holds the coupon. Stripe's
--    Coupon is immutable, so an edit here would leave the screen and
--    the invoice disagreeing about the price.
select _test_act_as(current_setting('test.owner')::uuid);
select throws_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'STRIPED', 'percent',
      current_setting('test.striped')::uuid, null, 90)$$,
  'This coupon has already been used — archive it and create a new one',
  'the discount cannot change once Stripe holds the coupon'
);
-- Renaming it is still fine — the freeze is on the money, not the row.
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'STRIPED', 'percent',
      current_setting('test.striped')::uuid, 'Twenty off', 20)$$,
  'but the name can still change'
);
-- And no client holds UPDATE on the table at all, so the trigger is a
-- second lock rather than the only one.
select ok(
  not has_table_privilege('authenticated', 'public.plan_coupons', 'update'),
  'no signed-in client can UPDATE plan_coupons directly'
);

-- 9. Staff who can assign plans but not manage them cannot write one.
select _test_act_as(current_setting('test.admin')::uuid);
select throws_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'adminmade', 'percent', null, null, 10)$$,
  'Not authorised',
  'an admin without can_manage_plans cannot write a coupon'
);

-- 10. Members cannot read the codes. The codes ARE the discount.
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select count(*)::int from public.plan_coupons),
  0,
  'a member cannot list the gym''s coupons'
);

-- 11. Grants: neither anon nor a signed-in member may record a
--     redemption; only the webhook's service role can.
select ok(
  not has_function_privilege(
    'authenticated',
    'public._apply_plan_coupon(uuid,uuid,uuid,uuid,text,text)',
    'execute'),
  'a member cannot mark a coupon redeemed'
);
select ok(
  not has_function_privilege('anon', 'public.preview_plan_coupon(uuid,uuid,text)', 'execute'),
  'anon cannot preview a coupon'
);

-- 12. A discount measured in months cannot be honoured on a one-off
--     pack, so it is refused before it can be half-applied (0265).
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'threemonths', 'percent',
      null, null, 25, null, 'repeating', 3)$$,
  'an owner can write a three-month offer'
);
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.pack')::uuid, 'THREEMONTHS')),
  'That code runs for several months, so it can''t be used on a one-off pack',
  'a repeating discount is refused on a credit pack'
);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.plan')::uuid, 'THREEMONTHS')),
  null,
  'and still applies to the membership beside it'
);
-- A one-off discount on a pack is fine — it is one charge either way.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$select public.upsert_plan_coupon(
      current_setting('test.gym')::uuid, 'tenoff', 'percent',
      null, null, 10)$$,
  'an owner can write a one-off offer'
);
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select reason from public.preview_plan_coupon(
     current_setting('test.gym')::uuid,
     current_setting('test.pack')::uuid, 'TENOFF')),
  null,
  'a one-off discount is fine on a pack'
);

select * from finish();
rollback;
