-- Athlete subscriptions (0068): is_athlete_active flips with
-- start/cancel, and a solo (gym_id NULL) tracked_workouts insert is
-- allowed only while the subscription is active.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_ath uuid := _test_mk_user('athlete@as.test');
begin
  perform set_config('test.ath', v_ath::text, true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.ath')::uuid); end $$;

-- 1. No subscription yet → inactive.
select is(
  public.is_athlete_active(current_setting('test.ath')::uuid),
  false,
  'a fresh athlete has no active subscription'
);

-- 2. Self-activate (free beta) → active.
do $$ begin perform public.start_athlete_subscription(); end $$;
select is(
  public.is_athlete_active(current_setting('test.ath')::uuid),
  true,
  'start_athlete_subscription activates the entitlement'
);

-- 3. Solo workout insert (gym_id NULL) is allowed while active.
select lives_ok(
  format(
    'insert into public.tracked_workouts (gym_id, profile_id, performed_at) values (null, %L::uuid, now())',
    current_setting('test.ath')
  ),
  'a gym-less workout logs while the athlete subscription is active'
);

-- 4. Cancel → inactive.
do $$ begin perform public.cancel_athlete_subscription(); end $$;
select is(
  public.is_athlete_active(current_setting('test.ath')::uuid),
  false,
  'cancel_athlete_subscription deactivates the entitlement'
);

-- 5. Solo insert is refused once inactive (RLS violation).
select throws_ok(
  format(
    'insert into public.tracked_workouts (gym_id, profile_id, performed_at) values (null, %L::uuid, now())',
    current_setting('test.ath')
  ),
  '42501',
  null,
  'a gym-less workout insert is refused once the subscription lapses'
);

select * from finish();
rollback;
