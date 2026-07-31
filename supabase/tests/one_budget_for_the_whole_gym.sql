-- One budget for the whole gym (0242).
--
-- Six jobs each capping themselves at three is eighteen questions a day,
-- which is the to-do list the Timeline was built to replace. The four
-- jobs that can wait share five.
--
-- The assertion that matters most is the last one: the jobs that CANNOT
-- wait must be untouched by the budget, or a gym in a busy week stops
-- chasing money and stops covering classes.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@budget.test');
  v_coach uuid := _test_mk_user('coach@budget.test');
  v_gym   uuid := _test_mk_gym('Budget Gym', 'budget-gym');
  v_pack  uuid;
  v_mship uuid;
  v_mem   uuid;
  v_sess  uuid;
  v_book  uuid;
  i       integer;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_gym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_pack;

  -- Eight members, all of them a textbook credits_low case: on a pack,
  -- two left, trained yesterday. Its own rule would let three through.
  for i in 1..8 loop
    v_mem := _test_mk_user('m' || i || '@budget.test');
    v_mship := _test_mk_membership(v_gym, v_mem, 'member');
    insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
    values (v_mship, v_mem, v_gym, v_pack, 'active', 2);
    v_sess := _test_mk_session(v_gym, v_coach, now() - interval '2 days'
                                              - (i || ' hours')::interval);
    v_book := _test_mk_booking(v_sess, v_mem);
    update public.class_bookings
      set attended_at = now() - interval '2 days', marked_by = v_coach
      where id = v_book;
  end loop;

  insert into public.agent_authority (gym_id, action_kind, level)
  values (v_gym, 'credits_low_message', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'credits_low_message', 'Hi {first_name} — {gym_name}.');

  perform set_config('test.gym', v_gym::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- The budget, before anything has been asked
-- ---------------------------------------------------------------------------

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  5,
  'a gym that has been asked nothing today has its whole budget'
);

-- ---------------------------------------------------------------------------
-- One job cannot take the lot
-- ---------------------------------------------------------------------------
--
-- Eight members all qualify. Its own rule stops at three, which is the
-- property that keeps whichever tick runs first from starving the rest.

select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'credits_low_message'),
  3,
  'the per-job cap still holds, so one job takes at most three of the five'
);

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  2,
  'and three of the five are spent'
);

-- ---------------------------------------------------------------------------
-- The budget counts across jobs, not within one
-- ---------------------------------------------------------------------------

do $$
begin
  -- Two more from a different job, by hand: the point is that the number
  -- is shared, not which tick wrote them.
  insert into public.agent_actions (gym_id, teammate, action_kind, status)
  values (current_setting('test.gym')::uuid, 'retention', 'retention_message', 'proposed'),
         (current_setting('test.gym')::uuid, 'retention', 'first_week_message', 'proposed');
end $$;

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  0,
  'two more from other jobs and the gym is out for the day'
);

-- ---------------------------------------------------------------------------
-- Spent means spent
-- ---------------------------------------------------------------------------
--
-- Five members still qualify for credits_low and its own cap has room
-- (three used of three... so clear one and prove the budget, not the cap,
-- is what refuses).

do $$
begin
  update public.agent_actions
    set proposed_at = now() - interval '2 days'
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'credits_low_message';
end $$;

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  3,
  'yesterday''s asks do not count against today'
);

-- The two hand-written rows are still inside the day, so the budget is
-- 3. The per-job cap is now clear. Five members remain unproposed-for,
-- and the tick must stop at three because of the budget.
select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'credits_low_message'
      and proposed_at > now() - interval '1 day'),
  3,
  'and the tick stops at what is left rather than at its own cap'
);

-- ---------------------------------------------------------------------------
-- The jobs that cannot wait
-- ---------------------------------------------------------------------------
--
-- A payment already missed has Stripe's own retry clock running, and an
-- uncovered class tomorrow is not the same message a day later. Neither
-- spends the budget, so a gym in a busy week never stops chasing money
-- or covering classes.

-- Clear room first. Asserting against a budget already floored at zero
-- would pass whether or not these kinds spend it.
do $$
begin
  update public.agent_actions
    set proposed_at = now() - interval '2 days'
    where gym_id = current_setting('test.gym')::uuid
      and action_kind in ('retention_message', 'first_week_message');
end $$;

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  2,
  'with three of today''s five spent, two are left'
);

do $$
begin
  insert into public.agent_actions (gym_id, teammate, action_kind, status)
  values (current_setting('test.gym')::uuid, 'revenue', 'chase_message', 'proposed'),
         (current_setting('test.gym')::uuid, 'revenue', 'plan_adjustment_offer', 'proposed'),
         (current_setting('test.gym')::uuid, 'ops', 'cover_ask', 'proposed');
end $$;

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  2,
  'and money and cover spend none of it — a gym in a busy week never '
  'stops chasing a payment or covering a class'
);

select finish();
rollback;
