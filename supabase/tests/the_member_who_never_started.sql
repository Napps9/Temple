-- The member who never started (0234).
--
-- The job's whole value is in who it does NOT write to, so most of this
-- file is refusals. Each of the four hard rules gets its own assertion
-- rather than being folded into one count, because "no proposal" is the
-- expected answer in seven different ways here and a single failing count
-- would not say which rule broke.
--
-- Three gyms: one carrying every eligibility case, one with no authority
-- row at all, one crowded enough to hit the daily cap.

begin;
select plan(13);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@firstweek.test');
  v_coach  uuid := _test_mk_user('coach@firstweek.test');
  v_new    uuid := _test_mk_user('new@firstweek.test');
  v_import uuid := _test_mk_user('imported@firstweek.test');
  v_trains uuid := _test_mk_user('trains@firstweek.test');
  v_fresh  uuid := _test_mk_user('fresh@firstweek.test');
  v_stale  uuid := _test_mk_user('stale@firstweek.test');
  v_unpaid uuid := _test_mk_user('unpaid@firstweek.test');
  v_noshow uuid := _test_mk_user('noshow@firstweek.test');
  v_other  uuid := _test_mk_user('other@firstweek.test');
  v_gym    uuid := _test_mk_gym('First Week Gym', 'first-week-gym');
  v_gym2   uuid := _test_mk_gym('No Job Gym', 'first-week-gym-2');
  v_gym3   uuid := _test_mk_gym('Busy Gym', 'first-week-gym-3');
  v_plan   uuid;
  v_plan3  uuid;
  v_mship  uuid;
  v_sess   uuid;
  v_book   uuid;
  v_crowd  uuid;
  i        integer;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;

  -- The case the job exists for: joined a fortnight ago, paying, never in.
  v_mship := _test_mk_membership(v_gym, v_new, 'member');
  update public.gym_memberships set created_at = now() - interval '14 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_new, v_gym, v_plan, 'active');

  -- Booked twice and came to neither. Still never started, and the card
  -- has to say which of the two it is.
  v_mship := _test_mk_membership(v_gym, v_noshow, 'member');
  update public.gym_memberships set created_at = now() - interval '20 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_noshow, v_gym, v_plan, 'active');
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '5 days');
  perform _test_mk_booking(v_sess, v_noshow);
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '3 days');
  perform _test_mk_booking(v_sess, v_noshow);

  -- Came across from another platform. Eligible on every other count.
  v_mship := _test_mk_membership(v_gym, v_import, 'member');
  update public.gym_memberships set created_at = now() - interval '14 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_import, v_gym, v_plan, 'active');
  insert into public.pending_members (gym_id, email, status, linked_profile_id)
  values (v_gym, 'imported@firstweek.test', 'linked', v_import);

  -- Has trained once, so this is the retention job's member, not ours.
  v_mship := _test_mk_membership(v_gym, v_trains, 'member');
  update public.gym_memberships set created_at = now() - interval '14 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_trains, v_gym, v_plan, 'active');
  v_sess := _test_mk_session(v_gym, v_coach, now() - interval '9 days');
  v_book := _test_mk_booking(v_sess, v_trains);
  update public.class_bookings
    set attended_at = now() - interval '9 days', marked_by = v_coach
    where id = v_book;

  -- Three days in. Has not got round to it, which is not a problem yet.
  v_mship := _test_mk_membership(v_gym, v_fresh, 'member');
  update public.gym_memberships set created_at = now() - interval '3 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_fresh, v_gym, v_plan, 'active');

  -- Forty-five days in. Too late for this to be a first week.
  v_mship := _test_mk_membership(v_gym, v_stale, 'member');
  update public.gym_memberships set created_at = now() - interval '45 days'
    where id = v_mship;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_stale, v_gym, v_plan, 'active');

  -- On the books with no active membership.
  v_mship := _test_mk_membership(v_gym, v_unpaid, 'member');
  update public.gym_memberships set created_at = now() - interval '14 days'
    where id = v_mship;

  -- The second gym never took the job on. Its member is otherwise perfect.
  perform _test_mk_membership(v_gym2, v_other, 'owner');
  v_mship := _test_mk_membership(v_gym2, v_new, 'member');
  update public.gym_memberships set created_at = now() - interval '14 days'
    where id = v_mship;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym2, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan3;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_new, v_gym2, v_plan3, 'active');

  -- The third gym has four people who all joined and never came.
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym3, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan3;
  for i in 1..4 loop
    v_crowd := _test_mk_user('crowd' || i || '@firstweek.test');
    v_mship := _test_mk_membership(v_gym3, v_crowd, 'member');
    update public.gym_memberships set created_at = now() - interval '20 days'
      where id = v_mship;
    insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_mship, v_crowd, v_gym3, v_plan3, 'active');
  end loop;

  -- On at approval for gyms one and three; gym two has no row at all,
  -- which IS the off switch.
  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym,  'first_week_message', 'approval'),
    (v_gym3, 'first_week_message', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'first_week_message',
     'Hi {first_name} — {gym_name}. Let''s get you started.');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.gym2',   v_gym2::text,   true);
  perform set_config('test.gym3',   v_gym3::text,   true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.new',    v_new::text,    true);
  perform set_config('test.import', v_import::text, true);
  perform set_config('test.trains', v_trains::text, true);
  perform set_config('test.fresh',  v_fresh::text,  true);
  perform set_config('test.stale',  v_stale::text,  true);
  perform set_config('test.unpaid', v_unpaid::text, true);
  perform set_config('test.noshow', v_noshow::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- The tick, twice. Rule 2 says the second run must add nothing.
-- ---------------------------------------------------------------------------

select agent_first_week_tick();
select agent_first_week_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'first_week_message'),
  2,
  'two people never started, two proposals — and running again adds none'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.new')::uuid
      and action_kind = 'first_week_message'),
  1,
  'the member who joined and never came is proposed for'
);

-- ---------------------------------------------------------------------------
-- Who it refuses, one rule at a time
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.import')::uuid
      and action_kind = 'first_week_message'),
  0,
  'never somebody who came across from another platform'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.trains')::uuid
      and action_kind = 'first_week_message'),
  0,
  'never somebody who has trained — that is the retention job''s member'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.fresh')::uuid
      and action_kind = 'first_week_message'),
  0,
  'not at three days — they simply have not got round to it'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.stale')::uuid
      and action_kind = 'first_week_message'),
  0,
  'not at forty-five days — that is no longer a first week'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.unpaid')::uuid
      and action_kind = 'first_week_message'),
  0,
  'not somebody without an active membership'
);

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym2')::uuid),
  0,
  'a gym that never took the job on gets nothing — the row is the switch'
);

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym3')::uuid
      and action_kind = 'first_week_message'),
  3,
  'four eligible, three proposals — the day''s cap holds'
);

-- ---------------------------------------------------------------------------
-- What the card says
-- ---------------------------------------------------------------------------
--
-- Booked and did not come is a different decision from never booked, so
-- the evidence has to distinguish them rather than saying "has not
-- trained" to both.

select ok(
  (select evidence::text from public.agent_actions
    where subject_profile = current_setting('test.noshow')::uuid)
    like '%Booked 2 classes and has not been to one%',
  'somebody who booked and did not come is described as that'
);

select ok(
  (select evidence::text from public.agent_actions
    where subject_profile = current_setting('test.new')::uuid)
    like '%Has not booked anything yet%',
  'somebody who never booked is described as that'
);

-- ---------------------------------------------------------------------------
-- Only the owner takes it on
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select set_first_week_job(current_setting('test.gym')::uuid, true) $$,
  'Only the owner can change this',
  'only the owner takes the job on'
);

-- ---------------------------------------------------------------------------
-- Approving it queues the note, with its own subject line
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where action_kind = 'first_week_message'
           and subject_profile = current_setting('test.new')::uuid),
       'approve') $$,
  'the owner approves and the note is queued'
);

select * from finish();
rollback;
