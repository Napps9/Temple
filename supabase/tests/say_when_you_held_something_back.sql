-- Say when you held something back (0244).
--
-- 0242 gave the gym a daily ask budget and spent it silently, so a quiet
-- Timeline could mean "nothing needed saying" or "five were said and
-- three are waiting" — opposite facts about the same gym.
--
-- The assertion that matters is the last one: a gym that was never held
-- back must say nothing at all, or the line becomes noise that appears
-- every day and stops meaning anything.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@held.test');
  v_coach uuid := _test_mk_user('coach@held.test');
  v_gym   uuid := _test_mk_gym('Held Gym', 'held-gym');
  v_calm  uuid := _test_mk_gym('Calm Gym', 'calm-gym');
  v_pack  uuid;
  v_mship uuid;
  v_mem   uuid;
  v_sess  uuid;
  v_book  uuid;
  i       integer;
begin
  perform _test_mk_membership(v_gym,  v_owner, 'owner');
  perform _test_mk_membership(v_calm, v_owner, 'owner');
  perform _test_mk_membership(v_gym,  v_coach, 'coach');

  insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents)
  values (v_gym, '10-class pack', 'credit_pack', 10, 9000)
  returning plan_id into v_pack;

  -- Eight textbook credits_low cases. Its own cap stops at three, and
  -- the budget is already spent by the fixture below, so all eight are
  -- held rather than three of them proposed.
  for i in 1..8 loop
    v_mem := _test_mk_user('h' || i || '@held.test');
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

  -- Today's five, already spent by other jobs.
  insert into public.agent_actions (gym_id, teammate, action_kind, status)
  select v_gym, 'retention', 'retention_message', 'proposed'
    from generate_series(1, 5);

  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.calm', v_calm::text, true);
end $$;

select is(
  public._agent_ask_budget_left(current_setting('test.gym')::uuid),
  0,
  'the gym has spent its five before the tick runs'
);

select agent_credits_low_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'credits_low_message'),
  0,
  'so nothing is proposed'
);

select is(
  (select held from public.agent_deferrals
    where gym_id = current_setting('test.gym')::uuid and on_day = current_date),
  8,
  'and every one it passed over is counted rather than forgotten'
);

-- One row per gym per day. A second tick on the same day adds to the
-- count instead of writing a second line into the owner's Timeline.
select agent_credits_low_tick();
select is(
  (select count(*)::int from public.agent_deferrals
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'a second tick the same day adds to the count, it does not add a line'
);

-- ---------------------------------------------------------------------------
-- What the owner sees
-- ---------------------------------------------------------------------------

select _test_act_as((select profile_id from public.gym_memberships
  where gym_id = current_setting('test.gym')::uuid and role = 'owner' limit 1));

select is(
  (select (detail->>'held')::int
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100)
    where kind = 'held_back'),
  16,
  'the Timeline carries the count, so a full day cannot look like a quiet one'
);

-- The line is only worth anything if it is rare. A gym that was never
-- held back says nothing, or it becomes daily furniture nobody reads.
select is(
  (select count(*)::int
     from timeline_feed(current_setting('test.calm')::uuid,
                        now() + interval '1 day', 100)
    where kind = 'held_back'),
  0,
  'and a gym that was never held back says nothing at all'
);

select finish();
rollback;
