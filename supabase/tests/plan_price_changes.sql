-- A price change reaches the checkout (0215).
--
-- The bug this pins is silent by construction: stripe_price_id is a cache
-- nobody looks at, and the only symptom is that Stripe charges an amount
-- no screen in the app displays. So the first half asserts the cache is
-- cleared when the price moves, is NOT cleared when the price stands
-- still, and is left alone when the caller sets it deliberately.
--
-- The second half is the capability. can_manage_plans is offered per-role
-- on the Team screen and was governing nothing — the table asked
-- user_is_owner_of. The assertions worth having are the pair: the same
-- admin, refused before the grant and allowed after it, with nothing
-- changing but one row in gym_role_capabilities.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@planprice.test');
  v_admin uuid := _test_mk_user('admin@planprice.test');
  v_coach uuid := _test_mk_user('coach@planprice.test');
  v_mem   uuid := _test_mk_user('member@planprice.test');
  v_gym   uuid := _test_mk_gym('Price Change', 'planprice');
  v_else  uuid := _test_mk_gym('Elsewhere', 'planpriceelse');
  v_plan  uuid;
  v_other uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_mem, 'member');
  perform _test_mk_membership(v_else, v_owner, 'owner');

  insert into public.membership_plans
    (gym_id, name, kind, monthly_price_cents, stripe_price_id)
  values (v_gym, 'Unlimited', 'unlimited', 5000, 'price_fifty')
  returning plan_id into v_plan;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_else, 'Theirs', 'unlimited', 4000) returning plan_id into v_other;

  -- Someone already paying £50, so the grandfathering claim on the card
  -- is a fact about this database rather than a hope about Stripe.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
     paid_period_end, imported_legacy)
  values (
    (select id from public.gym_memberships
      where gym_id = v_gym and profile_id = v_mem),
    v_mem, v_gym, v_plan, 'active'::public.plan_sub_state, 5000,
    now() + interval '30 days', true);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.else',  v_else::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.plan',  v_plan::text,  true);
  perform set_config('test.other', v_other::text, true);
end;
$$;

-- ============================================================================
-- The cached Stripe Price
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ update public.membership_plans set monthly_price_cents = 6000
       where plan_id = current_setting('test.plan')::uuid $$,
  'an owner can put the price up'
);

select is(
  (select stripe_price_id from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid),
  null,
  'and the cached Stripe Price is forgotten, so the next checkout mints one at the new amount'
);

select is(
  (select price_cents from public.plan_subscriptions
    where plan_id = current_setting('test.plan')::uuid),
  5000,
  'while the member already on it keeps what they signed up at'
);

-- Back to a cached price, to test the two cases that must NOT clear it.
update public.membership_plans set stripe_price_id = 'price_sixty'
  where plan_id = current_setting('test.plan')::uuid;

select lives_ok(
  $$ update public.membership_plans set name = 'Unlimited (all hours)'
       where plan_id = current_setting('test.plan')::uuid $$,
  'renaming a plan is not a price change'
);

select is(
  (select stripe_price_id from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid),
  'price_sixty',
  'so the cache survives it'
);

select lives_ok(
  $$ update public.membership_plans
       set monthly_price_cents = 7000, stripe_price_id = 'price_seventy'
       where plan_id = current_setting('test.plan')::uuid $$,
  'a caller may set both at once'
);

select is(
  (select stripe_price_id from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid),
  'price_seventy',
  'and the value they supplied is not thrown away — that write is the checkout filling the cache in'
);

-- ============================================================================
-- can_manage_plans governs the table it names
-- ============================================================================

select _test_act_as(current_setting('test.admin')::uuid);

select is(
  (select count(*)::int from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid
      and monthly_price_cents = 9000),
  0,
  'an admin without the capability changes nothing'
);

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'admin', 'can_manage_plans', true);

select _test_act_as(current_setting('test.admin')::uuid);

update public.membership_plans set monthly_price_cents = 9000
  where plan_id = current_setting('test.plan')::uuid;

select is(
  (select monthly_price_cents from public.membership_plans
    where plan_id = current_setting('test.plan')::uuid),
  9000,
  'the same admin, granted the capability, can — nothing changed but one row in gym_role_capabilities'
);

-- The grant is per-gym. Reaching sideways is the failure mode a
-- capability check invites, so it gets its own assertion — read back as
-- the other gym's owner, since the admin cannot even see that row.
update public.membership_plans set monthly_price_cents = 1
  where plan_id = current_setting('test.other')::uuid;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select monthly_price_cents from public.membership_plans
    where plan_id = current_setting('test.other')::uuid),
  4000,
  'and it does not reach a plan in a gym they are not in'
);

select _test_act_as(current_setting('test.coach')::uuid);

-- An INSERT the policy refuses raises rather than affecting no rows, so
-- this one is a throws_ok where the update above is a read-back.
select throws_ok(
  $$ insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
       values (current_setting('test.gym')::uuid, 'Coach made this', 'unlimited', 100) $$,
  '42501',
  null,
  'a coach the owner granted nothing still cannot create a plan'
);

select finish();
rollback;
