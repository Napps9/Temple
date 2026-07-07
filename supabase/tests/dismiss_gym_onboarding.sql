-- dismiss_gym_onboarding (0105) — owner-only, permanent (not
-- sessionStorage) onboarding dismissal so index.tsx's redirect gate
-- stays closed across sign-ins once an owner skips.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@dismissonboarding.test');
  v_coach  uuid := _test_mk_user('coach@dismissonboarding.test');
  v_gym    uuid := _test_mk_gym('Dismiss Onboarding Gym', 'dismiss-onboarding');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1. A coach (non-owner) cannot dismiss onboarding.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select throws_like(
  format('select dismiss_gym_onboarding(%L::uuid)', current_setting('test.gym')),
  '%Only an owner%',
  'a coach cannot dismiss onboarding'
);

-- 2. The owner can dismiss onboarding.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select lives_ok(
  format('select dismiss_gym_onboarding(%L::uuid)', current_setting('test.gym')),
  'the owner can dismiss onboarding'
);

-- 3. The gym row now carries a dismissal timestamp.
select isnt(
  (select onboarding_dismissed_at from public.gyms
    where id = current_setting('test.gym')::uuid),
  null,
  'onboarding_dismissed_at is stamped after dismissal'
);

select * from finish();
rollback;
