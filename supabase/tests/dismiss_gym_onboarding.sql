-- dismiss_gym_onboarding (0102):
--   * A new gym starts with onboarding_dismissed_at unset.
--   * Only an owner can dismiss it; a member is refused.
--   * The owner can dismiss it, stamping onboarding_dismissed_at.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@dismiss.test');
  v_member uuid := _test_mk_user('member@dismiss.test');
  v_gym    uuid := _test_mk_gym('Dismiss Gym', 'dismiss-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
end $$;

select id from auth.users where email = 'owner@dismiss.test' \gset owner_
select id from auth.users where email = 'member@dismiss.test' \gset member_

-- 1. A new gym has no dismissal stamp.
select is(
  (select onboarding_dismissed_at from public.gyms where slug = 'dismiss-gym'),
  null,
  'a new gym starts with onboarding_dismissed_at unset'
);

-- 2. A member cannot dismiss onboarding.
select _test_act_as(:'member_id'::uuid);
select throws_ok(
  $$ select public.dismiss_gym_onboarding((select id from public.gyms where slug = 'dismiss-gym')) $$,
  'Only an owner can dismiss onboarding',
  'a member is refused'
);

-- 3. The owner can dismiss onboarding.
select _test_act_as(:'owner_id'::uuid);
select lives_ok(
  $$ select public.dismiss_gym_onboarding((select id from public.gyms where slug = 'dismiss-gym')) $$,
  'the owner can dismiss onboarding'
);

-- 4. onboarding_dismissed_at is now stamped.
select ok(
  (select onboarding_dismissed_at from public.gyms where slug = 'dismiss-gym') is not null,
  'onboarding_dismissed_at is stamped after dismissal'
);

select * from finish();
rollback;
