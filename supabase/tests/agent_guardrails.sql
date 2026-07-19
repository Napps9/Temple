-- Guardrails (0143): agent email send caps, the conversation retention
-- sweep, and owner-only limit setters.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@guard.test');
  v_coach uuid := _test_mk_user('coach@guard.test');
  v_gym   uuid := _test_mk_gym('Guard Gym', 'guard-gym');
  v_conv  uuid;
  v_conv2 uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.gym_agent_settings (gym_id, enabled) values (v_gym, true);
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900900', 'voice') returning id into v_conv;
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900901', 'sms') returning id into v_conv2;
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.conv',  v_conv::text,  true);
  perform set_config('test.conv2', v_conv2::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1. The first agent email to an address is allowed.
select is(
  public.agent_email_send_allowed(current_setting('test.conv')::uuid, 'Prospect@Example.com'),
  true,
  'first email send is allowed'
);

-- 2. The per-address daily cap (3) blocks the fourth send.
do $$ begin
  perform public.agent_email_send_allowed(current_setting('test.conv')::uuid, 'prospect@example.com');
  perform public.agent_email_send_allowed(current_setting('test.conv')::uuid, 'prospect@example.com');
end $$;
select is(
  public.agent_email_send_allowed(current_setting('test.conv')::uuid, 'prospect@example.com'),
  false,
  'the fourth send in a day to one address is blocked'
);

-- 3. The address cap holds across conversations in the same gym.
select is(
  public.agent_email_send_allowed(current_setting('test.conv2')::uuid, 'PROSPECT@example.com'),
  false,
  'a different conversation cannot bypass the per-address cap'
);

-- 4. The per-conversation cap blocks a fourth send even to a new address.
select is(
  public.agent_email_send_allowed(current_setting('test.conv')::uuid, 'other@example.com'),
  false,
  'the per-conversation cap blocks a fourth send even to a new address'
);

-- 5-6. The retention sweep deletes conversations past the gym window and
-- queues their recordings for Storage-API deletion (direct storage.objects
-- deletes are blocked by storage.protect_delete). Superuser fixtures —
-- must run before any _test_act_as (its role change does not reliably
-- reset).
do $$ begin
  update public.gym_agent_settings
    set conversation_retention_days = 90
    where gym_id = current_setting('test.gym')::uuid;
  insert into public.call_recordings (gym_id, conversation_id, recording_path)
  values (current_setting('test.gym')::uuid, current_setting('test.conv2')::uuid,
          'guard-gym/old-call.mp3');
  update public.agent_conversations
    set last_message_at = now() - interval '120 days'
    where id = current_setting('test.conv2')::uuid;
  perform public.purge_expired_agent_conversations();
end $$;
select is(
  (select count(*)::int from public.agent_conversations
   where id = current_setting('test.conv2')::uuid),
  0,
  'conversations older than the retention window are purged'
);
select is(
  (select count(*)::int from public.agent_storage_purge_queue
   where path = 'guard-gym/old-call.mp3'),
  1,
  'the purged conversation''s recording is queued for Storage-API deletion'
);

-- 7. An owner saving a cap under the floor is rejected.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select throws_like(
  $$ select set_gym_agent_limits(current_setting('test.gym')::uuid, 5, 90) $$,
  '%at least 20%',
  'a cap under 20 is rejected'
);

-- 8-9. Coach cannot set limits; the send gate is internal only.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  $$ select set_gym_agent_limits(current_setting('test.gym')::uuid, 100, 90) $$,
  '%owner%',
  'a coach cannot change the agent limits'
);
select throws_like(
  format($$ select public.agent_email_send_allowed(%L::uuid, 'x@y.com') $$,
         current_setting('test.conv')),
  '%permission denied%',
  'agent_email_send_allowed is not callable by authenticated users'
);

select * from finish();
rollback;
