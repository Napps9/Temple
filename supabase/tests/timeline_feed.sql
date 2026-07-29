-- The Timeline's read-only feed (0204): one chronological stream per gym,
-- unioned from existing activity, with per-kind capability gating inside
-- the function — money rows behind can_see_money, lead/request rows behind
-- the plan-assign gate, cover rows behind the cover gate. Plus the
-- agent_actions ledger seed: staff-read only, no client writes.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@timeline.test');
  v_coach  uuid := _test_mk_user('coach@timeline.test');
  v_member uuid := _test_mk_user('member@timeline.test');
  v_joiner uuid := _test_mk_user('joiner@timeline.test');
  v_gym    uuid := _test_mk_gym('Timeline Gym', 'timeline-gym');
  v_other  uuid := _test_mk_gym('Other Gym', 'timeline-other-gym');
  v_plan   uuid;
  v_mship  uuid;
  v_sub    uuid;
  v_req    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.member', v_member::text, true);
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mship := _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_joiner, 'member');

  -- A lead (feeds lead_captured).
  insert into public.leads (gym_id, full_name, status)
  values (v_gym, 'Kelly Prospect', 'cold');

  -- A cover request with one open offer (feeds cover_requested).
  insert into public.cover_requests (gym_id, requested_by, range_start, range_end)
  values (v_gym, v_coach, now() + interval '1 day', now() + interval '2 days')
  returning id into v_req;

  -- A plan + subscription + dunning row (feeds payment_failing, money-gated).
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900)
  returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_member, v_gym, v_plan, 'active')
  returning id into v_sub;
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, payment_failure_count)
  values (v_sub, v_member, v_gym, 1);

  -- A pending membership change request (feeds membership_request).
  insert into public.membership_change_requests
    (gym_id, profile_id, plan_subscription_id, kind)
  values (v_gym, v_member, v_sub, 'cancel');

  -- A ledger row (feeds agent_action, money-gated).
  insert into public.agent_actions
    (gym_id, teammate, action_kind, subject_profile, subject_subscription, status)
  values (v_gym, 'revenue', 'chase_message', v_member, v_sub, 'executed');

  -- Noise in another gym that must never surface here.
  insert into public.leads (gym_id, full_name, status)
  values (v_other, 'Wrong Gym Lead', 'cold');
end $$;

-- ---------------------------------------------------------------------------
-- A member cannot read the feed at all.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  $$ select * from timeline_feed(current_setting('test.gym')::uuid) $$,
  'Not allowed',
  'member cannot call timeline_feed'
);

select is(
  (select count(*)::int from public.agent_actions),
  0,
  'member cannot read agent_actions'
);

-- ---------------------------------------------------------------------------
-- The owner sees every kind, scoped to their gym.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'member_joined'),
  2,
  'owner sees members joining'
);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'lead_captured'),
  1,
  'owner sees the lead — and only this gym''s'
);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'payment_failing'),
  1,
  'owner sees the failing payment'
);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'membership_request'),
  1,
  'owner sees the pending membership request'
);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'agent_action'),
  1,
  'owner sees the ledger receipt'
);

select is(
  (select detail->>'request_kind'
     from timeline_feed(current_setting('test.gym')::uuid)
    where kind = 'membership_request'),
  'cancel',
  'request card carries its kind'
);

-- Feed is newest-first and respects the limit.
select is(
  (select count(*)::int from timeline_feed(
     current_setting('test.gym')::uuid, null, 2)),
  2,
  'limit caps the feed'
);

select is(
  (select occurred_at from timeline_feed(
     current_setting('test.gym')::uuid) limit 1),
  (select max(occurred_at) from timeline_feed(
     current_setting('test.gym')::uuid)),
  'newest row first'
);

-- ---------------------------------------------------------------------------
-- A coach (default capabilities: cover + plan-assign, but not money) sees
-- the cover request and the lead, but no money rows.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind in ('cover_requested', 'lead_captured')),
  2,
  'coach sees cover + lead rows'
);

select is(
  (select count(*)::int from timeline_feed(current_setting('test.gym')::uuid)
    where kind in ('payment_failing', 'agent_action')),
  0,
  'coach without can_see_money sees no money rows'
);

select * from finish();
rollback;
