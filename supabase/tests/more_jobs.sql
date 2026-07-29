-- Keeping members + finding cover (0208): the retention tick finds a
-- fading regular once, the cover tick finds an unclaimed offer inside the
-- warning window once, the cover re-ask lands through the existing
-- cover_notifications plumbing, and the switch-ons stay owner-only.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@jobs.test');
  v_coach  uuid := _test_mk_user('coach@jobs.test');
  v_member uuid := _test_mk_user('member@jobs.test');
  v_gym    uuid := _test_mk_gym('Jobs Gym', 'jobs-gym');
  v_mship  uuid;
  v_plan   uuid;
  v_past   uuid;
  v_future uuid;
  v_book   uuid;
  v_req    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mship := _test_mk_membership(v_gym, v_member, 'member');

  -- A regular gone quiet: active plan, last attended 30 days ago.
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_member, v_gym, v_plan, 'active');
  v_past := _test_mk_session(v_gym, v_coach, now() - interval '30 days');
  v_book := _test_mk_booking(v_past, v_member);
  update public.class_bookings
    set attended_at = now() - interval '30 days' where id = v_book;

  -- An unclaimed cover offer on a class 24h out (inside the default
  -- 48-hour warning window).
  v_future := _test_mk_session(v_gym, v_coach, now() + interval '24 hours');
  insert into public.cover_requests (gym_id, requested_by, range_start, range_end)
  values (v_gym, v_coach, now(), now() + interval '2 days')
  returning id into v_req;
  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values (v_req, v_future, v_coach, v_gym);

  -- Both jobs on, at approval.
  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym, 'retention_message', 'approval'),
    (v_gym, 'cover_ask', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'retention_message',
     'Hi {first_name} — {gym_name}. We''ve missed you.');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- Superuser phase: the ticks.
-- ---------------------------------------------------------------------------
select agent_retention_tick();
select agent_retention_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'retention_message'),
  1,
  'one fading member, one proposal — the 45-day window holds across ticks'
);

select agent_cover_tick();
select agent_cover_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'cover_ask'),
  1,
  'one uncovered request, one ask a day'
);

-- Execute the cover ask (superuser stands in for the approval): the
-- re-ask lands as cover_notifications for the one claimable coach — the
-- owner (the requester is excluded) — on both channels.
update public.agent_actions set status = 'approved'
  where action_kind = 'cover_ask';
select _agent_execute_action(
  (select id from public.agent_actions where action_kind = 'cover_ask'));

select is(
  (select count(*)::int from public.cover_notifications
    where idempotency_key like 'agent-cover-ask:%'),
  2,
  'the re-ask reaches the claimable coach in-app and by email'
);

select is(
  (select status from public.agent_actions where action_kind = 'cover_ask'),
  'executed',
  'the cover ask is ledgered as executed'
);

-- ---------------------------------------------------------------------------
-- Coach: cannot switch jobs on.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select set_retention_job(current_setting('test.gym')::uuid, true) $$,
  'Only the owner can change this',
  'only the owner takes the retention job on'
);

-- ---------------------------------------------------------------------------
-- Owner: approving the retention note queues the templated message.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where action_kind = 'retention_message' and status = 'proposed'),
       'approve') $$,
  'owner approves the reach-out'
);

select ok(
  (select subject like 'We''ve missed you at%'
     from public.agent_outbound_messages
    where gym_id = current_setting('test.gym')::uuid limit 1),
  'the note goes out under the retention subject, from the template'
);

select * from finish();
rollback;
