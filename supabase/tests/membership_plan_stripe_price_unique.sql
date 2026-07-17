-- One active Temple plan per Stripe price per gym (0130). The Stripe
-- importer could previously create duplicate plans on re-run; a partial
-- unique index now makes that impossible, while leaving manually-created
-- plans (null stripe_price_id) and re-imports after archiving unaffected.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@spu.test');
  v_gym   uuid := _test_mk_gym('SPU Gym', 'spu-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym', v_gym::text, true);
end $$;

-- 1. First plan for a Stripe price inserts fine.
insert into public.membership_plans (gym_id, name, kind, stripe_price_id)
  values (current_setting('test.gym')::uuid, 'Monthly', 'unlimited', 'price_a');
select pass('first plan for a Stripe price inserts');

-- 2. A second active plan for the same price is rejected.
select throws_ok(
  $$insert into public.membership_plans (gym_id, name, kind, stripe_price_id)
      values (current_setting('test.gym')::uuid, 'Monthly dup', 'unlimited', 'price_a')$$,
  '23505',
  null,
  'a second active plan for the same Stripe price is rejected'
);

-- 3. Plans with no Stripe price id are unconstrained (manual plans).
do $$
begin
  insert into public.membership_plans (gym_id, name, kind)
    values (current_setting('test.gym')::uuid, 'Manual A', 'unlimited');
  insert into public.membership_plans (gym_id, name, kind)
    values (current_setting('test.gym')::uuid, 'Manual B', 'unlimited');
end $$;
select pass('plans with no Stripe price id are unconstrained');

-- 4. Archiving the active plan frees the price for a fresh import.
update public.membership_plans set archived_at = now()
  where gym_id = current_setting('test.gym')::uuid
    and stripe_price_id = 'price_a';
insert into public.membership_plans (gym_id, name, kind, stripe_price_id)
  values (current_setting('test.gym')::uuid, 'Monthly again', 'unlimited', 'price_a');
select pass('a fresh plan for the price is allowed once the old one is archived');

select * from finish();
rollback;
