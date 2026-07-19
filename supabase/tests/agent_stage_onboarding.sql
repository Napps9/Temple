-- agent_stage_onboarding (0138): the AI agent pre-fills a new member's
-- onboarding by staging a pending_members row, keyed on (gym, email), and
-- backfills the lead's email. Service-role only.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@stage.test');
  v_coach uuid := _test_mk_user('coach@stage.test');
  v_gym   uuid := _test_mk_gym('Stage Gym', 'stage-gym');
  v_gym_b uuid := _test_mk_gym('Other Gym', 'other-stage-gym');
  v_lead  uuid;
  v_conv  uuid;
  v_plan  uuid;
  v_plan_b uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.leads (gym_id, full_name, phone, status)
  values (v_gym, 'Sam Prospect', '+447700900700', 'contacted')
  returning id into v_lead;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900700', 'voice', v_lead) returning id into v_conv;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 5000) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym_b, 'Foreign Plan', 'unlimited', 9000) returning plan_id into v_plan_b;
  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.lead', v_lead::text, true);
  perform set_config('test.conv', v_conv::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.plan', v_plan::text, true);
  perform set_config('test.plan_b', v_plan_b::text, true);
end $$;

-- 1-3. Staging creates a pending_members row and backfills the lead email.
do $$ begin
  perform public.agent_stage_onboarding(
    current_setting('test.conv')::uuid, 'Sam Prospect', 'Sam@Example.com');
end $$;

select is(
  (select count(*)::int from public.pending_members
   where gym_id = current_setting('test.gym')::uuid and lower(email) = 'sam@example.com'),
  1,
  'a pending_members row is staged for the new member'
);
select is(
  (select status from public.pending_members
   where gym_id = current_setting('test.gym')::uuid and lower(email) = 'sam@example.com'),
  'invited',
  'the staged member is marked invited'
);
select is(
  (select email from public.leads where id = current_setting('test.lead')::uuid),
  'sam@example.com',
  'the linked lead has its email backfilled'
);

-- 4. Re-staging the same email dedups (still one row) and updates the name.
do $$ begin
  perform public.agent_stage_onboarding(
    current_setting('test.conv')::uuid, 'Samuel Prospect', 'sam@example.com');
end $$;
select is(
  (select count(*)::int from public.pending_members
   where gym_id = current_setting('test.gym')::uuid and lower(email) = 'sam@example.com'),
  1,
  're-staging the same email dedups instead of inserting'
);

-- 5-6. Staging with the agreed plan records it and moves the lead to
-- 'committed' so the board shows the close.
do $$ begin
  perform public.agent_stage_onboarding(
    current_setting('test.conv')::uuid, 'Samuel Prospect', 'sam@example.com',
    current_setting('test.plan')::uuid);
end $$;
select is(
  (select agreed_plan_id from public.pending_members
   where gym_id = current_setting('test.gym')::uuid and lower(email) = 'sam@example.com'),
  current_setting('test.plan')::uuid,
  'the agreed plan is staged on the pending member'
);
select is(
  (select status::text from public.leads where id = current_setting('test.lead')::uuid),
  'committed',
  'the linked lead advances to committed at close'
);

-- 7. A plan belonging to another gym is ignored, keeping the earlier one.
do $$ begin
  perform public.agent_stage_onboarding(
    current_setting('test.conv')::uuid, 'Samuel Prospect', 'sam@example.com',
    current_setting('test.plan_b')::uuid);
end $$;
select is(
  (select agreed_plan_id from public.pending_members
   where gym_id = current_setting('test.gym')::uuid and lower(email) = 'sam@example.com'),
  current_setting('test.plan')::uuid,
  'a cross-gym plan id is not staged'
);

-- 8. A missing/invalid email is rejected.
select throws_like(
  format($$ select public.agent_stage_onboarding(%L::uuid, 'No Email', 'not-an-email') $$,
         current_setting('test.conv')),
  '%valid email%',
  'an invalid email is rejected'
);

-- 9. Internal only: an authenticated caller cannot execute it.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select public.agent_stage_onboarding(%L::uuid, 'X', 'x@y.com') $$,
         current_setting('test.conv')),
  '%permission denied%',
  'agent_stage_onboarding is not callable by authenticated users'
);

select * from finish();
rollback;
