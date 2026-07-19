-- agent_notify_handoff_reply (0142): a prospect reply into a handed_off AI
-- conversation pings the assigned coach through lead_notifications, hourly
-- throttled by the idempotency key. Service-role only.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@handoff.test');
  v_coach uuid := _test_mk_user('coach@handoff.test');
  v_gym   uuid := _test_mk_gym('Handoff Gym', 'handoff-gym');
  v_lead  uuid;
  v_conv  uuid;
  v_conv2 uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id)
  values (v_gym, 'Hot Lead', '+447700900800', 'contacted', v_coach)
  returning id into v_lead;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id, status)
  values (v_gym, '+447700900800', 'sms', v_lead, 'handed_off')
  returning id into v_conv;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id, status)
  values (v_gym, '+447700900800', 'voice', v_lead, 'active')
  returning id into v_conv2;
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.lead',  v_lead::text,  true);
  perform set_config('test.conv',  v_conv::text,  true);
  perform set_config('test.conv2', v_conv2::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1-2. A reply into a handed_off thread notifies the assigned coach.
do $$ begin
  perform public.agent_notify_handoff_reply(current_setting('test.conv')::uuid);
end $$;
select cmp_ok(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.lead')::uuid
     and idempotency_key like '%agent-reply%'),
  '>=', 1,
  'a handed-off reply enqueues a coach notification'
);
select is(
  (select count(distinct recipient_profile_id)::int from public.lead_notifications
   where lead_id = current_setting('test.lead')::uuid
     and idempotency_key like '%agent-reply%'),
  1,
  'the notification goes to the assigned coach only'
);

-- 3. A second reply in the same hour dedups on the idempotency key.
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.lead_notifications
    where lead_id = current_setting('test.lead')::uuid
      and idempotency_key like '%agent-reply%';
  perform public.agent_notify_handoff_reply(current_setting('test.conv')::uuid);
  select count(*) into v_after from public.lead_notifications
    where lead_id = current_setting('test.lead')::uuid
      and idempotency_key like '%agent-reply%';
  perform set_config('test.repeat_delta', (v_after - v_before)::text, true);
end $$;
select is(
  current_setting('test.repeat_delta')::int, 0,
  'a repeat reply within the hour adds no new notifications'
);

-- 4. An active (not handed off) conversation notifies nobody.
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.lead_notifications;
  perform public.agent_notify_handoff_reply(current_setting('test.conv2')::uuid);
  select count(*) into v_after from public.lead_notifications;
  perform set_config('test.active_delta', (v_after - v_before)::text, true);
end $$;
select is(
  current_setting('test.active_delta')::int, 0,
  'an active conversation triggers no handoff notification'
);

-- 5. Internal only: an authenticated caller cannot execute it.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select public.agent_notify_handoff_reply(%L::uuid) $$,
         current_setting('test.conv')),
  '%permission denied%',
  'agent_notify_handoff_reply is not callable by authenticated users'
);

select * from finish();
rollback;
