-- Training history follows the athlete tier (0237).
--
-- Two failure modes, opposite in direction, and both would be quiet:
-- somebody who is paying losing sight of their record, and somebody who
-- stopped paying keeping it. Every assertion below is one or the other.
--
-- The last two are the ones that keep this lawful. Gating a product is a
-- commercial choice; gating somebody's right of access is not available,
-- so export_my_training_history has to answer for exactly the person the
-- policies have just refused.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_coach uuid := _test_mk_user('coach@hist.test');
  v_here  uuid := _test_mk_user('here@hist.test');
  v_gone  uuid := _test_mk_user('gone@hist.test');
  v_paid  uuid := _test_mk_user('paid@hist.test');
  v_gym   uuid := _test_mk_gym('History Gym', 'history-gym');
  v_m     uuid;
  v_w     uuid;
begin
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  -- Still a member. Nothing about their experience may change.
  perform _test_mk_membership(v_gym, v_here, 'member');
  insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
  values (v_gym, v_here, now() - interval '5 days', 'Fran');

  -- Left, not paying. The record stays in the database untouched; they
  -- simply cannot browse it until they subscribe.
  v_m := _test_mk_membership(v_gym, v_gone, 'member');
  update public.gym_memberships set left_at = now() - interval '30 days'
    where id = v_m;
  insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
  values (v_gym, v_gone, now() - interval '60 days', 'Murph')
  returning id into v_w;
  insert into public.tracked_movement_results
    (gym_id, profile_id, workout_id, movement_key, track_key, value_numeric,
     performed_at)
  values (v_gym, v_gone, v_w, 'back_squat', '1rm', 100,
          now() - interval '60 days');

  -- Left, and paying. Everything back, including the gym-era rows.
  v_m := _test_mk_membership(v_gym, v_paid, 'member');
  update public.gym_memberships set left_at = now() - interval '30 days'
    where id = v_m;
  insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
  values (v_gym, v_paid, now() - interval '70 days', 'Cindy');
  insert into public.athlete_subscriptions (profile_id, status)
  values (v_paid, 'active');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.here',  v_here::text,  true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.paid',  v_paid::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- The member who is still in the gym: nothing changes for them
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.here')::uuid);

select is(
  (select count(*)::int from public.tracked_workouts),
  1,
  'a member in the gym reads their own history, tier or no tier'
);

select lives_ok(
  $$ insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
     values (current_setting('test.gym')::uuid,
             current_setting('test.here')::uuid, now(), 'Grace') $$,
  'and can still log a workout to their gym'
);

-- ---------------------------------------------------------------------------
-- The member who left and is not paying
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.gone')::uuid);

select is(
  (select count(*)::int from public.tracked_workouts),
  0,
  'somebody who left and does not subscribe cannot browse their history'
);

select is(
  (select count(*)::int from public.tracked_movement_results),
  0,
  'nor their movement results'
);

-- The write half. This is the hole the tier existed to close: before
-- 0237 they could keep logging into the gym they left, free.
select throws_ok(
  $$ insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
     values (current_setting('test.gym')::uuid,
             current_setting('test.gone')::uuid, now(), 'Sneaky') $$,
  '42501',
  null,
  'and cannot log a new workout to the gym they left'
);

select throws_ok(
  $$ insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
     values (null, current_setting('test.gone')::uuid, now(), 'Solo') $$,
  '42501',
  null,
  'nor log a solo one without the tier — that is what it sells'
);

-- The right of access is not a product feature and does not follow the
-- subscription. The same person the policies just refused gets everything.
select is(
  jsonb_array_length(
    public.export_my_training_history()->'workouts'),
  1,
  'but their export still returns the workout in full, free'
);

select ok(
  (public.export_my_training_history()->'workouts'->0->'movement_results')
    @> '[{"movement_key": "back_squat"}]'::jsonb,
  'with the movement results nested inside it'
);

-- And the screen that sells the tier can still say what is waiting. Left
-- to the policies alone, /athlete would tell somebody their history is
-- theirs and then show them nothing, which is the pitch and the evidence
-- contradicting each other.
select is(
  (public.my_training_summary()->>'workouts')::int,
  1,
  'the summary still counts what is waiting, so the pitch is not a bluff'
);

select ok(
  (public.my_training_summary()->>'first_at') is not null
    and (public.my_training_summary()->>'gyms')::int = 1,
  'and says how far back it goes and how many gyms it spans'
);

-- ---------------------------------------------------------------------------
-- The member who left and subscribed
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.paid')::uuid);

select is(
  (select count(*)::int from public.tracked_workouts),
  1,
  'subscribing brings the gym-era history back, untouched'
);

select lives_ok(
  $$ insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
     values (null, current_setting('test.paid')::uuid, now(), 'Solo') $$,
  'and solo logging is what they are paying for'
);

select * from finish();
rollback;
