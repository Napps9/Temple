-- gyms.currency + set_gym_currency (0106):
--   * A new gym defaults to GBP.
--   * Only an owner can change it; a member is refused.
--   * The owner can set it; the code is stored upper-cased.
--   * A non-ISO code is refused.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@cur.test');
  v_member uuid := _test_mk_user('member@cur.test');
  v_gym    uuid := _test_mk_gym('Currency Gym', 'cur-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
end $$;

-- Resolve ids while still the privileged setup role — auth.users is not
-- readable once the session switches to an authenticated member.
select id from auth.users where email = 'owner@cur.test' \gset owner_
select id from auth.users where email = 'member@cur.test' \gset member_

-- 1. Defaults to GBP.
select is(
  (select currency from public.gyms where slug = 'cur-gym'),
  'GBP',
  'a new gym defaults to GBP'
);

-- 2. A member cannot change it.
select _test_act_as(:'member_id'::uuid);
select throws_ok(
  $$ select public.set_gym_currency((select id from public.gyms where slug = 'cur-gym'), 'USD') $$,
  'Only an owner can change the gym currency',
  'a member is refused'
);

-- 3. The owner can set it; lower-case input is stored upper-cased.
select _test_act_as(:'owner_id'::uuid);
select lives_ok(
  $$ select public.set_gym_currency((select id from public.gyms where slug = 'cur-gym'), 'usd') $$,
  'the owner can set the currency'
);
select is(
  (select currency from public.gyms where slug = 'cur-gym'),
  'USD',
  'the currency is stored upper-cased'
);

-- 4. A non-ISO code is refused.
select throws_ok(
  $$ select public.set_gym_currency((select id from public.gyms where slug = 'cur-gym'), 'pounds') $$,
  'Invalid currency code: pounds',
  'a non-ISO currency code is refused'
);

select * from finish();
rollback;
