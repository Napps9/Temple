-- request_payment_chase (0248): the Needs chasing list can hand a case to
-- the revenue teammate. The tap is the approval — the action is born
-- approved with the tapper as decided_by — but every agent guardrail
-- still binds: capability, job switch, two-touch cap, one chase per case.
--
-- The tick is cron-only, so both tick runs happen in the superuser phase
-- before the first _test_act_as (see money_loop.sql / _helpers.psql).

begin;
select plan(17);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@chase.test');
  v_coach   uuid := _test_mk_user('coach@chase.test');
  v_m1      uuid := _test_mk_user('m1@chase.test');
  v_m2      uuid := _test_mk_user('m2@chase.test');
  v_m3      uuid := _test_mk_user('m3@chase.test');
  v_m4      uuid := _test_mk_user('m4@chase.test');
  v_gym     uuid := _test_mk_gym('Chase Gym', 'chase-gym');
  v_gymoff  uuid := _test_mk_gym('Job Off Gym', 'chase-job-off-gym');
  v_owneroff uuid := _test_mk_user('owneroff@chase.test');
  v_moff    uuid := _test_mk_user('moff@chase.test');
  v_plan    uuid;
  v_planoff uuid;
  v_ms1 uuid; v_ms2 uuid; v_ms3 uuid; v_ms4 uuid; v_msoff uuid;
  v_sub1 uuid; v_sub2 uuid; v_sub3 uuid; v_sub4 uuid; v_suboff uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_ms1 := _test_mk_membership(v_gym, v_m1, 'member');
  v_ms2 := _test_mk_membership(v_gym, v_m2, 'member');
  v_ms3 := _test_mk_membership(v_gym, v_m3, 'member');
  v_ms4 := _test_mk_membership(v_gym, v_m4, 'member');
  perform _test_mk_membership(v_gymoff, v_owneroff, 'owner');
  v_msoff := _test_mk_membership(v_gymoff, v_moff, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 7500) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gymoff, 'Unlimited', 'unlimited', 7500) returning plan_id into v_planoff;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms1, v_m1, v_gym, v_plan, 'active', 7500) returning id into v_sub1;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms2, v_m2, v_gym, v_plan, 'active', 7500) returning id into v_sub2;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms3, v_m3, v_gym, v_plan, 'active', 7500) returning id into v_sub3;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms4, v_m4, v_gym, v_plan, 'active', 7500) returning id into v_sub4;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_msoff, v_moff, v_gymoff, v_planoff, 'active', 7500)
  returning id into v_suboff;

  -- sub1: 4 days failing, retry ahead — the tick will propose a chase.
  -- sub2: 1 day failing — too young for the tick, exactly the row the
  -- manual chase exists for. sub4 stays healthy. The job-off gym fails
  -- too, but has no authority rows.
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  values
    (v_sub1, v_m1, v_gym, now() - interval '4 days', 2, now() + interval '2 days'),
    (v_sub2, v_m2, v_gym, now() - interval '1 day', 1, now() + interval '3 days'),
    (v_suboff, v_moff, v_gymoff, now() - interval '4 days', 2, now() + interval '2 days');

  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym, 'chase_message', 'approval'),
    (v_gym, 'plan_adjustment_offer', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'chase_message', 'Hi {first_name} — {gym_name}. Your {plan_name} payment needs a look.');

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.gymoff',  v_gymoff::text,  true);
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.owneroff', v_owneroff::text, true);
  perform set_config('test.coach',   v_coach::text,   true);
  perform set_config('test.m1',      v_m1::text,      true);
  perform set_config('test.sub1',    v_sub1::text,    true);
  perform set_config('test.sub2',    v_sub2::text,    true);
  perform set_config('test.sub3',    v_sub3::text,    true);
  perform set_config('test.sub4',    v_sub4::text,    true);
  perform set_config('test.suboff',  v_suboff::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- Superuser phase: the tick proposes for sub1, opens a case for sub2, and
-- sub3 starts failing only after the tick has been — no case exists for it.
-- ---------------------------------------------------------------------------
select agent_revenue_tick();

select is(
  (select count(*)::int from public.agent_actions a
    join public.agent_cases c on c.id = a.case_id
    where c.plan_subscription_id = current_setting('test.sub1')::uuid
      and a.status = 'proposed' and a.action_kind = 'chase_message'),
  1,
  'the tick proposes a chase for the 4-day failure'
);

do $$
begin
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  select current_setting('test.sub3')::uuid, ps.profile_id, ps.gym_id,
         now() - interval '2 days', 1, now() + interval '3 days'
    from public.plan_subscriptions ps
    where ps.id = current_setting('test.sub3')::uuid;
end $$;

select is(
  (select count(*)::int from public.agent_cases
    where plan_subscription_id = current_setting('test.sub3')::uuid),
  0,
  'no case exists yet for the failure the tick has not seen'
);

-- ---------------------------------------------------------------------------
-- Member and coach: same wall as decide_agent_action.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.m1')::uuid);

select throws_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub1')::uuid) $$,
  'Not allowed',
  'member cannot request a chase'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub1')::uuid) $$,
  'Not allowed',
  'coach without can_see_money cannot request a chase'
);

-- ---------------------------------------------------------------------------
-- Owner: hand cases over.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

-- sub1 carries the tick's open question: the request becomes that yes.
select lives_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub1')::uuid) $$,
  'owner hands over a case the tick already asked about'
);

select is(
  (select count(*)::int from public.agent_actions a
    join public.agent_cases c on c.id = a.case_id
    where c.plan_subscription_id = current_setting('test.sub1')::uuid),
  1,
  'the pending proposal is approved, not duplicated'
);

select is(
  (select a.status from public.agent_actions a
    join public.agent_cases c on c.id = a.case_id
    where c.plan_subscription_id = current_setting('test.sub1')::uuid),
  'executed',
  'the handed-over chase executes immediately'
);

select is(
  (select a.decided_by from public.agent_actions a
    join public.agent_cases c on c.id = a.case_id
    where c.plan_subscription_id = current_setting('test.sub1')::uuid),
  current_setting('test.owner')::uuid,
  'the tap is recorded as the decision'
);

select ok(
  (select m.body like 'Hi %payment needs a look.'
     from public.agent_outbound_messages m
     join public.agent_cases c on c.id = m.case_id
    where c.plan_subscription_id = current_setting('test.sub1')::uuid
    limit 1),
  'the queued message comes from the approved template'
);

-- sub2 is one day old — far inside the tick's 3-day patience.
select lives_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub2')::uuid) $$,
  'a failure too young for the tick can still be chased by hand'
);

select is(
  (select stage from public.agent_cases
    where plan_subscription_id = current_setting('test.sub2')::uuid),
  'touch_2_sent',
  'the case advances exactly as an agent chase would'
);

-- sub3 has no case at all: the request opens one itself.
select lives_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub3')::uuid) $$,
  'a failure with no case yet gets one opened by the request'
);

select is(
  (select count(*)::int from public.agent_cases
    where plan_subscription_id = current_setting('test.sub3')::uuid
      and stage = 'touch_2_sent'),
  1,
  'the opened case carries the executed chase'
);

-- sub4 is paying fine.
select throws_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub4')::uuid) $$,
  'That payment is not failing',
  'a healthy subscription cannot be chased'
);

-- The two-touch cap counts manual touches too.
select lives_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub1')::uuid) $$,
  'a second chase is the last allowed touch'
);

select throws_ok(
  $$ select request_payment_chase(
       current_setting('test.gym')::uuid,
       current_setting('test.sub1')::uuid) $$,
  'Already chased twice',
  'the third touch is refused, same cap as the tick'
);

-- ---------------------------------------------------------------------------
-- A gym that never switched the job on has no teammate to hand to.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owneroff')::uuid);

select throws_ok(
  $$ select request_payment_chase(
       current_setting('test.gymoff')::uuid,
       current_setting('test.suboff')::uuid) $$,
  'The money job is not switched on',
  'no authority rows means no handover'
);

select * from finish();
rollback;
