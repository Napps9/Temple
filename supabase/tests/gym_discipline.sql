-- gyms.discipline + set_gym_discipline (0088):
--   * A new gym defaults to the 'crossfit' discipline.
--   * Only an owner can change it; a member is refused.
--   * The owner can switch it to 'hyrox'.
--   * An unknown discipline value is refused.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@disc.test');
  v_member uuid := _test_mk_user('member@disc.test');
  v_gym    uuid := _test_mk_gym('Discipline Gym', 'disc-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
end $$;

-- Resolve the profile ids up front, while the session is still the
-- privileged setup role — auth.users is not readable once we switch to
-- an 'authenticated' member below.
select id from auth.users where email = 'owner@disc.test' \gset owner_
select id from auth.users where email = 'member@disc.test' \gset member_

-- 1. Defaults to crossfit.
select is(
  (select discipline from public.gyms where slug = 'disc-gym'),
  'crossfit',
  'a new gym starts on the crossfit discipline'
);

-- 2. A member cannot change it.
select _test_act_as(:'member_id'::uuid);
select throws_ok(
  $$ select public.set_gym_discipline((select id from public.gyms where slug = 'disc-gym'), 'hyrox') $$,
  'Only an owner can change the gym discipline',
  'a member is refused'
);

-- 3. The owner can switch to hyrox.
select _test_act_as(:'owner_id'::uuid);
select lives_ok(
  $$ select public.set_gym_discipline((select id from public.gyms where slug = 'disc-gym'), 'hyrox') $$,
  'the owner can switch the gym to hyrox'
);
select is(
  (select discipline from public.gyms where slug = 'disc-gym'),
  'hyrox',
  'the discipline is now hyrox'
);

-- 4. An unknown discipline is refused.
select throws_ok(
  $$ select public.set_gym_discipline((select id from public.gyms where slug = 'disc-gym'), 'powerlifting') $$,
  'Unknown discipline: powerlifting',
  'an unknown discipline value is refused'
);

select * from finish();
rollback;
