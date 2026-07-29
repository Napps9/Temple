-- The money loop (0206): authority is the flag, the tick is deterministic,
-- decisions are capability-gated, and the send queue only ever fills from
-- an approved action + an owner-approved template.
--
-- The tick is cron-only (revoked from authenticated), so every tick run
-- happens in the superuser phase BEFORE the first _test_act_as — the role
-- GUC cannot reliably be unset once switched (see _helpers.psql notes).

begin;
select plan(18);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@money.test');
  v_coach   uuid := _test_mk_user('coach@money.test');
  v_member  uuid := _test_mk_user('member@money.test');
  v_member2 uuid := _test_mk_user('member2@money.test');
  v_gym     uuid := _test_mk_gym('Money Gym', 'money-gym');
  v_gym2    uuid := _test_mk_gym('Auto Gym', 'money-auto-gym');
  v_owner2  uuid := _test_mk_user('owner2@money.test');
  v_mship   uuid;
  v_mship2  uuid;
  v_plan    uuid;
  v_cheap   uuid;
  v_plan2   uuid;
  v_sub     uuid;
  v_sub2    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mship := _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym2, v_owner2, 'owner');
  v_mship2 := _test_mk_membership(v_gym2, v_member2, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Basic', 'unlimited', 5900) returning plan_id into v_cheap;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym2, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan2;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mship, v_member, v_gym, v_plan, 'active', 8900)
  returning id into v_sub;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mship2, v_member2, v_gym2, v_plan2, 'active', 8900)
  returning id into v_sub2;

  -- Live failures: 4 days old, Stripe still retrying — touch-2 territory.
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  values
    (v_sub, v_member, v_gym, now() - interval '4 days', 2, now() + interval '2 days'),
    (v_sub2, v_member2, v_gym2, now() - interval '4 days', 2, now() + interval '2 days');

  -- Gym 1 works on approval; gym 2 has graduated chases to autonomous.
  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym, 'chase_message', 'approval'),
    (v_gym, 'plan_adjustment_offer', 'approval'),
    (v_gym2, 'chase_message', 'autonomous'),
    (v_gym2, 'plan_adjustment_offer', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'chase_message', 'Hi {first_name} — {gym_name}. Your {plan_name} payment needs a look.'),
    (v_gym, 'plan_adjustment_offer', 'Hi {first_name} — we could move you to {offer_plan} at {offer_price}.'),
    (v_gym2, 'chase_message', 'Hi {first_name} — {gym_name}. Your {plan_name} payment needs a look.'),
    (v_gym2, 'plan_adjustment_offer', 'Hi {first_name} — we could move you to {offer_plan} at {offer_price}.');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.gym2',   v_gym2::text,   true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub2',   v_sub2::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- Superuser phase: the tick.
-- ---------------------------------------------------------------------------
select agent_revenue_tick();

select is(
  (select count(*)::int from public.agent_cases
    where gym_id = current_setting('test.gym')::uuid and stage <> 'closed'),
  1,
  'tick opens a case for the failing payment'
);

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid and status = 'proposed'
      and action_kind = 'chase_message'),
  1,
  'approval gym gets a proposed chase, not a sent one'
);

select agent_revenue_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'a second tick does not stack a second question'
);

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym2')::uuid and status = 'executed'),
  1,
  'autonomous gym executes the chase without asking'
);

select is(
  (select count(*)::int from public.agent_outbound_messages
    where gym_id = current_setting('test.gym2')::uuid and status = 'queued'),
  1,
  'the executed chase queues exactly one message'
);

select ok(
  (select body like 'Hi %payment needs a look.'
     from public.agent_outbound_messages
    where gym_id = current_setting('test.gym2')::uuid limit 1),
  'message text comes from the approved template'
);

-- Recovery: the dunning row disappears, the next tick closes the case.
delete from public.plan_subscription_dunning
  where plan_subscription_id = current_setting('test.sub2')::uuid;
select agent_revenue_tick();

select is(
  (select outcome from public.agent_cases
    where gym_id = current_setting('test.gym2')::uuid),
  'recovered',
  'a vanished dunning row on an active subscription closes the case recovered'
);

-- ---------------------------------------------------------------------------
-- Member: sees nothing, decides nothing.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.member')::uuid);

select is(
  (select count(*)::int from public.agent_cases),
  0,
  'member cannot read cases'
);

select throws_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions limit 1), 'approve') $$,
  'Not allowed',
  'member cannot decide'
);

-- ---------------------------------------------------------------------------
-- Coach without can_see_money: same wall.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select decide_agent_action(
       (select a.id from public.agent_actions a
         join public.gyms g on g.id = a.gym_id
        where g.slug = 'money-gym' limit 1), 'approve') $$,
  'Not allowed',
  'coach without can_see_money cannot decide'
);

select throws_ok(
  $$ select set_money_job(
       (select id from public.gyms where slug = 'money-gym'), true) $$,
  'Only the owner can change this',
  'only the owner switches the job on'
);

-- ---------------------------------------------------------------------------
-- Owner: approve with always-allow; the whole chain fires.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where gym_id = current_setting('test.gym')::uuid
           and status = 'proposed' limit 1),
       'approve', true) $$,
  'owner approves the chase with always-allow'
);

select is(
  (select status from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid limit 1),
  'executed',
  'approval executes the action'
);

select is(
  (select count(*)::int from public.agent_outbound_messages
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'the approved chase queues its message'
);

select is(
  (select level from public.agent_authority
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'chase_message'),
  'autonomous',
  'always-allow flips the dial in the same transaction'
);

select is(
  (select stage from public.agent_cases
    where gym_id = current_setting('test.gym')::uuid),
  'touch_2_sent',
  'the case advances'
);

select throws_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where gym_id = current_setting('test.gym')::uuid limit 1), 'approve') $$,
  'Already decided',
  'a decision cannot be re-made'
);

select lives_ok(
  $$ select set_money_job(
       (select id from public.gyms where slug = 'money-gym'), false) $$,
  'owner can switch the job off'
);

select * from finish();
rollback;
