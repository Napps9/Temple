-- agent_outcomes + agent_flag_health_mention (0148): the owner's results
-- roll-up for the AI front desk, and the no-details health flag.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@outcome.test');
  v_coach  uuid := _test_mk_user('coach@outcome.test');
  v_member uuid := _test_mk_user('member@outcome.test');
  v_gym    uuid := _test_mk_gym('Outcome Gym', 'outcome-gym');
  v_gm     uuid;
  v_src    uuid;
  v_plan   uuid;
  v_lead1  uuid;
  v_conv   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_gm := _test_mk_membership(v_gym, v_member, 'member');
  insert into public.lead_sources (gym_id, label, color)
  values (v_gym, 'AI front desk', '#0EA5E9') returning id into v_src;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 5000) returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_gm, v_member, v_gym, v_plan, 'active', 4500);

  insert into public.leads (gym_id, full_name, phone, status, source_id, assigned_coach_id)
  values (v_gym, 'Hot Prospect', '+447700900960', 'committed', v_src, v_coach)
  returning id into v_lead1;
  insert into public.leads
    (gym_id, full_name, phone, status, source_id, converted_at, converted_profile_id)
  values (v_gym, 'New Member', '+447700900961', 'converted', v_src, now(), v_member);
  insert into public.leads (gym_id, full_name, phone, status)
  values (v_gym, 'Walk In', '+447700900962', 'cold');

  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900960', 'voice', v_lead1) returning id into v_conv;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.lead1', v_lead1::text, true);
  perform set_config('test.conv',  v_conv::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1-3. The health flag writes one fixed marker (idempotent) and pings the
-- assigned coach. Superuser calls — before any _test_act_as.
do $$ begin
  perform public.agent_flag_health_mention(current_setting('test.conv')::uuid);
  perform public.agent_flag_health_mention(current_setting('test.conv')::uuid);
end $$;
select like(
  (select notes from public.leads where id = current_setting('test.lead1')::uuid),
  '%health concern%',
  'the health flag lands as a note on the lead'
);
select is(
  (select notes from public.leads where id = current_setting('test.lead1')::uuid),
  'Mentioned an injury or health concern — have a coach check in before their first session (details deliberately not recorded).',
  'the marker is fixed text, written once, with no medical details'
);
select cmp_ok(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.lead1')::uuid
     and idempotency_key like '%health-mention%'),
  '>=', 1,
  'the assigned coach is notified'
);

-- 4-7. The owner's outcomes roll-up.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select is(
  (select leads_30d from public.agent_outcomes(current_setting('test.gym')::uuid)),
  2,
  'agent-sourced leads are counted; other sources are not'
);
select is(
  (select committed from public.agent_outcomes(current_setting('test.gym')::uuid)),
  1,
  'committed agent leads are counted'
);
select is(
  (select converted_30d from public.agent_outcomes(current_setting('test.gym')::uuid)),
  1,
  'converted agent leads are counted'
);
select is(
  (select attributed_monthly_cents from public.agent_outcomes(current_setting('test.gym')::uuid)),
  4500::bigint,
  'attributed revenue uses the subscription price snapshot'
);

-- 8-9. A coach gets no roll-up and cannot call the flag directly.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_outcomes(current_setting('test.gym')::uuid)),
  0,
  'agent_outcomes returns nothing for non-owners'
);
select throws_like(
  format($$ select public.agent_flag_health_mention(%L::uuid) $$,
         current_setting('test.conv')),
  '%permission denied%',
  'the health flag is not callable by authenticated users'
);

select * from finish();
rollback;
