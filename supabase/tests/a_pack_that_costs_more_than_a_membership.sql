-- A pack that costs more than a membership (0241).
--
-- Most of the value is in who it refuses, so each rule gets its own
-- assertion. The two that matter most are the arithmetic and the coupling:
-- the job must stay quiet when the pack is genuinely the better product,
-- and when it does speak the top-up nudge has to step aside rather than
-- contradict it five minutes later.

begin;
select plan(14);

\ir _helpers.psql

-- Books p_n attended classes for a member, spread p_days_ago back from
-- now, one session each so no booking collides with another.
create or replace function public._t_attend(
  p_gym uuid, p_coach uuid, p_profile uuid, p_n integer, p_days_ago integer
) returns void
language plpgsql
as $$
declare
  i      integer;
  v_sess uuid;
  v_book uuid;
  v_when timestamptz;
begin
  for i in 1..p_n loop
    v_when := now() - (p_days_ago || ' days')::interval - (i || ' hours')::interval;
    v_sess := _test_mk_session(p_gym, p_coach, v_when);
    v_book := _test_mk_booking(v_sess, p_profile);
    update public.class_bookings
      set attended_at = v_when, marked_by = p_coach
      where id = v_book;
  end loop;
end;
$$;

do $$
declare
  v_owner  uuid := _test_mk_user('owner@upgrade.test');
  v_coach  uuid := _test_mk_user('coach@upgrade.test');
  v_heavy  uuid := _test_mk_user('heavy@upgrade.test');
  v_mid    uuid := _test_mk_user('mid@upgrade.test');
  v_light  uuid := _test_mk_user('light@upgrade.test');
  v_thin   uuid := _test_mk_user('thin@upgrade.test');
  v_full   uuid := _test_mk_user('full@upgrade.test');
  v_gone   uuid := _test_mk_user('gone@upgrade.test');
  v_period uuid := _test_mk_user('period@upgrade.test');
  v_gym    uuid := _test_mk_gym('Upgrade Gym', 'upgrade-gym');
  v_aowner uuid := _test_mk_user('owner@auto.test');
  v_acoach uuid := _test_mk_user('coach@auto.test');
  v_amem   uuid := _test_mk_user('member@auto.test');
  v_agym   uuid := _test_mk_gym('Auto Gym', 'auto-upgrade-gym');
  v_pack   uuid;
  v_p12    uuid;
  v_p8     uuid;
  v_unl    uuid;
  v_apack  uuid;
  v_aunl   uuid;
  v_mship  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  -- £90 for ten classes is £9 a class. Everything below is that number
  -- against the three recurring plans beside it in the same catalogue.
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_gym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_pack;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
  values (v_gym, '12 a month', 'credit_period', 12, '1 mon', 6000)
  returning plan_id into v_p12;
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
  values (v_gym, '8 a month', 'credit_period', 8, '1 mon', 7000)
  returning plan_id into v_p8;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_unl;

  -- 14 a month at £9 is £126. Nothing but Unlimited covers 14, and £89
  -- saves them £37 — the case the job exists for.
  v_mship := _test_mk_membership(v_gym, v_heavy, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_heavy, v_gym, v_pack, 'active', 2);
  perform _t_attend(v_gym, v_coach, v_heavy, 14, 1);

  -- 10 a month is £90, and "12 a month" at £60 covers them for £30 less.
  -- Cheaper than Unlimited, so it has to be the one offered.
  v_mship := _test_mk_membership(v_gym, v_mid, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_mid, v_gym, v_pack, 'active', 1);
  perform _t_attend(v_gym, v_coach, v_mid, 10, 1);

  -- 4 a month is £36. Every membership here costs more. The pack is the
  -- right product for them and the job has nothing to say.
  v_mship := _test_mk_membership(v_gym, v_light, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_light, v_gym, v_pack, 'active', 2);
  perform _t_attend(v_gym, v_coach, v_light, 4, 1);

  -- 8 a month is £72 against £60: better, by £12, on £72 of spending.
  -- Under a fifth, so this is a nag about rounding.
  v_mship := _test_mk_membership(v_gym, v_thin, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_thin, v_gym, v_pack, 'active', 2);
  perform _t_attend(v_gym, v_coach, v_thin, 8, 1);

  -- The arithmetic favours them, but they have eight classes left. Nothing
  -- is about to be bought, so nothing needs saying.
  v_mship := _test_mk_membership(v_gym, v_full, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_full, v_gym, v_pack, 'active', 8);
  perform _t_attend(v_gym, v_coach, v_full, 14, 1);

  -- Trained fourteen times, all of it 25 days ago. Inside the 30-day
  -- window the arithmetic reads, outside the 21-day floor — retention's
  -- member, not this job's.
  v_mship := _test_mk_membership(v_gym, v_gone, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_gone, v_gym, v_pack, 'active', 2);
  perform _t_attend(v_gym, v_coach, v_gone, 14, 25);

  -- Two left on a monthly allowance, which resets. Only a pack runs out.
  v_mship := _test_mk_membership(v_gym, v_period, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_period, v_gym, v_p12, 'active', 2);
  perform _t_attend(v_gym, v_coach, v_period, 14, 1);

  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym, 'plan_upgrade_offer',  'approval'),
    (v_gym, 'credits_low_message', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'plan_upgrade_offer',
     'Hi {first_name} — {gym_name}. {offer_plan} at {offer_price} would be '
     || '{upgrade_saving} better off than another {plan_name}.'),
    (v_gym, 'credits_low_message',
     'Hi {first_name} — {gym_name}. You have {credits_left} on your {plan_name}.');

  -- A second gym, so the autonomous case is not fighting the first gym's
  -- three-a-day cap for room.
  perform _test_mk_membership(v_agym, v_aowner, 'owner');
  perform _test_mk_membership(v_agym, v_acoach, 'coach');
  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_agym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_apack;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_agym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_aunl;
  v_mship := _test_mk_membership(v_agym, v_amem, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mship, v_amem, v_agym, v_apack, 'active', 1);
  perform _t_attend(v_agym, v_acoach, v_amem, 14, 1);
  insert into public.agent_authority (gym_id, action_kind, level)
  values (v_agym, 'plan_upgrade_offer', 'autonomous');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_agym, 'plan_upgrade_offer',
     'Hi {first_name} — {gym_name}. {offer_plan} at {offer_price}.');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.heavy',  v_heavy::text,  true);
  perform set_config('test.mid',    v_mid::text,    true);
  perform set_config('test.light',  v_light::text,  true);
  perform set_config('test.thin',   v_thin::text,   true);
  perform set_config('test.full',   v_full::text,   true);
  perform set_config('test.gone',   v_gone::text,   true);
  perform set_config('test.period', v_period::text, true);
  perform set_config('test.agym',   v_agym::text,   true);
  perform set_config('test.amem',   v_amem::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- The tick, twice
-- ---------------------------------------------------------------------------

select agent_plan_upgrade_tick();
select agent_plan_upgrade_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'plan_upgrade_offer'),
  2,
  'two members are paying more for a pack than a membership would cost, '
  'and a second run adds nothing'
);

-- ---------------------------------------------------------------------------
-- Which membership it names
-- ---------------------------------------------------------------------------

select is(
  (select payload->>'offer_plan_name' from public.agent_actions
    where subject_profile = current_setting('test.heavy')::uuid
      and action_kind = 'plan_upgrade_offer'),
  'Unlimited',
  'fourteen a month: only Unlimited covers them, so that is what is offered'
);

-- The cheapest plan that COVERS them, not the cheapest plan. "12 a month"
-- is £29 less than Unlimited and still reaches the way they train.
select is(
  (select payload->>'offer_plan_name' from public.agent_actions
    where subject_profile = current_setting('test.mid')::uuid
      and action_kind = 'plan_upgrade_offer'),
  '12 a month',
  'ten a month: the cheapest plan that still covers them wins'
);

-- ---------------------------------------------------------------------------
-- Who it refuses
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.light')::uuid
      and action_kind = 'plan_upgrade_offer'),
  0,
  'never somebody the pack is genuinely cheaper for'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.thin')::uuid
      and action_kind = 'plan_upgrade_offer'),
  0,
  'nor for a saving under a fifth of what they spend'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.full')::uuid
      and action_kind = 'plan_upgrade_offer'),
  0,
  'nor with eight classes left — nothing is about to be bought'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.gone')::uuid
      and action_kind = 'plan_upgrade_offer'),
  0,
  'nor somebody who stopped coming three weeks ago'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.period')::uuid
      and action_kind = 'plan_upgrade_offer'),
  0,
  'nor a monthly allowance — that balance resets, so it never runs out'
);

-- ---------------------------------------------------------------------------
-- What it says
-- ---------------------------------------------------------------------------

select ok(
  (select evidence::text from public.agent_actions
    where subject_profile = current_setting('test.heavy')::uuid
      and action_kind = 'plan_upgrade_offer')
    like '%£37 better off%',
  'the evidence names the saving in the gym''s own currency'
);

-- ---------------------------------------------------------------------------
-- The top-up nudge steps aside
-- ---------------------------------------------------------------------------

select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.heavy')::uuid
      and action_kind = 'credits_low_message'),
  0,
  'nobody is told to top up five minutes after being told there is a '
  'cheaper way'
);

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.light')::uuid
      and action_kind = 'credits_low_message'),
  1,
  'while everybody the upgrade job passed over still gets the top-up nudge'
);

-- Rejecting the upgrade is an answer about the upgrade, not about the
-- top-up. Losing both over one "no" would cost the member the reminder
-- that actually stops them being locked out, so the exclusion reads the
-- status and lets them back through on the next tick.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$ select decide_agent_action(
       (select id from public.agent_actions
         where subject_profile = current_setting('test.heavy')::uuid
           and action_kind = 'plan_upgrade_offer'),
       'reject') $$,
  'the owner says no to the upgrade'
);

-- Back to the cron's own role: the ticks are revoked from authenticated,
-- so a tick called while acting as the owner would be refused.
select set_config('role', 'postgres', true);
select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where subject_profile = current_setting('test.heavy')::uuid
      and action_kind = 'credits_low_message'),
  1,
  'and the top-up nudge comes back to them on the next tick'
);

-- ---------------------------------------------------------------------------
-- Autonomous sends, in its own gym
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.agent_outbound_messages o
     join public.agent_actions aa on aa.id = o.action_id
    where aa.gym_id = current_setting('test.agym')::uuid
      and aa.action_kind = 'plan_upgrade_offer'
      and aa.status = 'executed'),
  1,
  'autonomous executes and queues the note; approval leaves it proposed'
);

select * from finish();
rollback;
