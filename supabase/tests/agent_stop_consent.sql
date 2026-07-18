-- agent_stop_conversation (0136): STOP closes the thread and withdraws
-- marketing consent on the linked lead. A lead-less thread just closes.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@agstop.test');
  v_gym   uuid := _test_mk_gym('Stop Gym', 'agstop');
  v_lead  uuid;
  v_conv1 uuid;
  v_conv2 uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.leads
    (gym_id, full_name, phone, marketing_consent, consent_at)
  values (v_gym, 'Opted In', '+447700900200', true, now())
  returning id into v_lead;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900200', 'sms', v_lead) returning id into v_conv1;
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900201', 'sms') returning id into v_conv2;
  perform set_config('test.lead',  v_lead::text,  true);
  perform set_config('test.conv1', v_conv1::text, true);
  perform set_config('test.conv2', v_conv2::text, true);
end $$;

do $$ begin
  perform public.agent_stop_conversation(current_setting('test.conv1')::uuid);
end $$;

select is(
  (select status from public.agent_conversations
   where id = current_setting('test.conv1')::uuid),
  'closed',
  'STOP closes the conversation'
);
select is(
  (select marketing_consent from public.leads
   where id = current_setting('test.lead')::uuid),
  false,
  'STOP withdraws marketing consent on the linked lead'
);
select is(
  (select consent_at from public.leads
   where id = current_setting('test.lead')::uuid),
  null,
  'STOP clears the consent timestamp'
);

do $$ begin
  perform public.agent_stop_conversation(current_setting('test.conv2')::uuid);
end $$;
select is(
  (select status from public.agent_conversations
   where id = current_setting('test.conv2')::uuid),
  'closed',
  'a conversation with no lead just closes'
);

select * from finish();
rollback;
