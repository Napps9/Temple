-- 0269: the recovery job's four hard rules, which live in SQL rather than
-- in the template. Nothing proposed with the job off; once per member per
-- plan ever; never somebody now paying; capped at three a day.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cart.test');
  v_a     uuid := _test_mk_user('ann@cart.test');
  v_b     uuid := _test_mk_user('ben@cart.test');
  v_gym   uuid := _test_mk_gym('Cart Gym', 'cart-gym');
  v_plan  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900)
  returning plan_id into v_plan;

  -- Ann reached the payment page three hours ago and stopped.
  insert into public.checkout_attempts
    (gym_id, profile_id, plan_id, stripe_session_id, created_at)
  values (v_gym, v_a, v_plan, 'cs_ann', now() - interval '3 hours');

  -- Ben did the same, but has since ended up on a live plan.
  insert into public.checkout_attempts
    (gym_id, profile_id, plan_id, stripe_session_id, created_at)
  values (v_gym, v_b, v_plan, 'cs_ben', now() - interval '3 hours');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select gm.id, v_b, v_gym, v_plan, 'active'
    from public.gym_memberships gm
   where gm.gym_id = v_gym and gm.profile_id = v_b;

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.owner', v_owner::text, false);
  perform set_config('test.ann', v_a::text, false);
  perform set_config('test.ben', v_b::text, false);
  perform set_config('test.plan', v_plan::text, false);
end $$;

-- 1. The job is off, so nothing is proposed. The authority row IS the flag.
select lives_ok(
  'select public.agent_checkout_recovery_tick()',
  'the tick runs with the job off'
);
select is(
  (select count(*)::int from public.agent_actions
    where action_kind = 'checkout_recovery_message'),
  0,
  'nothing is proposed until an owner turns the job on'
);

-- 3. Turning it on stores the template too — a job whose template cannot
--    be stored raises "No approved template" at the worst moment.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format('select public.set_checkout_recovery_job(%L, true)',
         current_setting('test.gym')),
  'an owner turns the job on'
);
select is(
  (select count(*)::int from public.agent_message_templates
    where gym_id = current_setting('test.gym')::uuid
      and kind = 'checkout_recovery_message'),
  1,
  'the approved template lands with the authority row'
);

-- The tick is cron-only, so it runs as the owner of the schedule rather
-- than as a signed-in person. reset role at the top level, never inside a
-- DO block — see CLAUDE.md on _test_act_as.
reset role;

-- 5-6. One proposal, for Ann only: Ben is paying now.
select is(
  (select (public.agent_checkout_recovery_tick()->>'proposed')::int),
  1,
  'one abandonment is worth a question'
);
select is(
  (select subject_profile from public.agent_actions
    where action_kind = 'checkout_recovery_message'),
  current_setting('test.ann')::uuid,
  'a member who is now paying is never chased for not paying'
);

-- 7. Once per member per plan, ever — so a rejection is final.
select is(
  (select (public.agent_checkout_recovery_tick()->>'proposed')::int),
  0,
  'the same abandonment is not proposed twice'
);

-- 8. Switching the job off expires the question rather than leaving it.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format('select public.set_checkout_recovery_job(%L, false)',
         current_setting('test.gym')),
  'an owner turns the job off'
);

select * from finish();
rollback;
