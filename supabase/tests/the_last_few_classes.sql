-- The last few classes on a pack (0235).
--
-- Same shape as the first-week file: most of the value is in who it
-- refuses, so each rule gets its own assertion rather than one count that
-- could go wrong five ways without saying which.
--
-- The two that matter most are the plan kind and the 21-day floor. A
-- credit_period balance resets, so "two left" is a normal Thursday and a
-- note about it is a nag; and a member who has stopped coming needs the
-- retention job, not a renewal prompt.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@credits.test');
  v_coach  uuid := _test_mk_user('coach@credits.test');
  v_low    uuid := _test_mk_user('low@credits.test');
  v_one    uuid := _test_mk_user('one@credits.test');
  v_period uuid := _test_mk_user('period@credits.test');
  v_empty  uuid := _test_mk_user('empty@credits.test');
  v_plenty uuid := _test_mk_user('plenty@credits.test');
  v_gone   uuid := _test_mk_user('gone@credits.test');
  v_unltd  uuid := _test_mk_user('unlimited@credits.test');
  v_gym    uuid := _test_mk_gym('Credits Gym', 'credits-gym');
  v_pack   uuid;
  v_per    uuid;
  v_unl    uuid;
  v_mship  uuid;
  v_sess   uuid;
  v_book   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_gym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_pack;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
  values (v_gym, '8 a month', 'credit_period', 8, '1 mon', 7000)
  returning plan_id into v_per;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_unl;

  -- Two left on a pack, training last week: the case the job exists for.
  v_mship := _test_mk_membership(v_gym, v_low, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_low, v_gym, v_pack, 'active', 2);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '4 days');
  v_book := _test_mk_booking(v_sess, v_low);
  update public.class_bookings
    set attended_at = now() - interval '4 days', marked_by = v_coach
    where id = v_book;

  -- One left. Same case, and the copy has to read as "1 class", not "1 classes".
  v_mship := _test_mk_membership(v_gym, v_one, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_one, v_gym, v_pack, 'active', 1);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_book := _test_mk_booking(v_sess, v_one);
  update public.class_bookings
    set attended_at = now() - interval '2 days', marked_by = v_coach
    where id = v_book;

  -- Two left on a monthly allowance. Resets — a normal Thursday.
  v_mship := _test_mk_membership(v_gym, v_period, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance,
     period_resets_at)
  values (v_mship, v_period, v_gym, v_per, 'active', 2,
          now() + interval '9 days');
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '3 days');
  v_book := _test_mk_booking(v_sess, v_period);
  update public.class_bookings
    set attended_at = now() - interval '3 days', marked_by = v_coach
    where id = v_book;

  -- Run out already: the booking screen has told them.
  v_mship := _test_mk_membership(v_gym, v_empty, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_empty, v_gym, v_pack, 'active', 0);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_book := _test_mk_booking(v_sess, v_empty);
  update public.class_bookings
    set attended_at = now() - interval '2 days', marked_by = v_coach
    where id = v_book;

  -- Six left: nothing to say yet.
  v_mship := _test_mk_membership(v_gym, v_plenty, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_plenty, v_gym, v_pack, 'active', 6);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_book := _test_mk_booking(v_sess, v_plenty);
  update public.class_bookings
    set attended_at = now() - interval '2 days', marked_by = v_coach
    where id = v_book;

  -- Two left but last trained 40 days ago. Retention's member, not ours.
  v_mship := _test_mk_membership(v_gym, v_gone, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_gone, v_gym, v_pack, 'active', 2);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '40 days');
  v_book := _test_mk_booking(v_sess, v_gone);
  update public.class_bookings
    set attended_at = now() - interval '40 days', marked_by = v_coach
    where id = v_book;

  -- Unlimited: no balance to run down.
  v_mship := _test_mk_membership(v_gym, v_unltd, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_unltd, v_gym, v_unl, 'active', null);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '2 days');
  v_book := _test_mk_booking(v_sess, v_unltd);
  update public.class_bookings
    set attended_at = now() - interval '2 days', marked_by = v_coach
    where id = v_book;

  insert into public.agent_authority (gym_id, action_kind, level)
  values (v_gym, 'credits_low_message', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'credits_low_message',
     'Hi {first_name} — {gym_name}. You have {credits_left} on your {plan_name}.');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.low',    v_low::text,    true);
  perform set_config('test.one',    v_one::text,    true);
  perform set_config('test.period', v_period::text, true);
  perform set_config('test.empty',  v_empty::text,  true);
  perform set_config('test.plenty', v_plenty::text, true);
  perform set_config('test.gone',   v_gone::text,   true);
  perform set_config('test.unltd',  v_unltd::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- The tick, twice
-- ---------------------------------------------------------------------------

select agent_credits_low_tick();
select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'credits_low_message'),
  2,
  'two people are near the end of a pack, and a second run adds nothing'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.low')::uuid),
  1,
  'two left on a pack, still training — proposed'
);

-- ---------------------------------------------------------------------------
-- Who it refuses
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.period')::uuid),
  0,
  'never a monthly allowance — that balance resets, so low is normal'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.empty')::uuid),
  0,
  'not at zero — they are already locked out and know it'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.plenty')::uuid),
  0,
  'not with six left — there is nothing to say yet'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.gone')::uuid),
  0,
  'not somebody who stopped coming — that is the retention job''s member'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.unltd')::uuid),
  0,
  'not somebody on unlimited — no balance to run down'
);

-- ---------------------------------------------------------------------------
-- What it says
-- ---------------------------------------------------------------------------

select ok(
  (select evidence::text from public.agent_actions
    where subject_profile = current_setting('test.one')::uuid)
    like '%1 class left on their 10-class pack%',
  'one left reads as "1 class", not "1 classes"'
);

select ok(
  (select evidence::text from public.agent_actions
    where subject_profile = current_setting('test.low')::uuid)
    like '%2 classes left%',
  'two left reads as "2 classes"'
);

-- ---------------------------------------------------------------------------
-- Only the owner takes it on
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select set_credits_low_job(current_setting('test.gym')::uuid, true) $$,
  'Only the owner can change this',
  'only the owner takes the job on'
);

-- ---------------------------------------------------------------------------
-- Approving it queues the note, with the count written into the body
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where subject_profile = current_setting('test.one')::uuid),
       'approve') $$,
  'the owner approves and the note is queued'
);

select * from finish();
rollback;
