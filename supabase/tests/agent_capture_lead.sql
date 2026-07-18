-- agent_capture_lead + agent_request_handoff (0136): tenancy comes from
-- the conversation row, the 'AI front desk' source is created once, phone
-- dedup folds repeat captures into one lead, and handoff notifies the
-- assigned coach through the existing queue.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@agcap.test');
  v_coach uuid := _test_mk_user('coach@agcap.test');
  v_gym   uuid := _test_mk_gym('Capture Gym', 'agcap');
  v_conv  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900123', 'sms') returning id into v_conv;
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.conv',  v_conv::text,  true);
end $$;

-- 1-4. First capture: lead created with the conversation's phone, tagged
-- with the auto-created source, round-robin assigned, linked back.
do $$
declare
  v_id uuid;
begin
  v_id := public.agent_capture_lead(
    current_setting('test.conv')::uuid, 'Sam Prospect', null, 'Wants mornings');
  perform set_config('test.lead', v_id::text, true);
end $$;

select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  '+447700900123',
  'the lead phone comes from the conversation, not the caller'
);
select is(
  (select ls.label from public.leads l
   join public.lead_sources ls on ls.id = l.source_id
   where l.id = current_setting('test.lead')::uuid),
  'AI front desk',
  'the AI front desk source is created and attached'
);
select is(
  (select assigned_coach_id from public.leads
   where id = current_setting('test.lead')::uuid),
  current_setting('test.coach')::uuid,
  'assign_lead hands the lead to the coach'
);
select is(
  (select lead_id from public.agent_conversations
   where id = current_setting('test.conv')::uuid),
  current_setting('test.lead')::uuid,
  'the conversation is linked to the lead'
);

-- 5-7. Second capture on the same conversation dedups into the same lead,
-- appends notes, backfills email, and does not duplicate the source.
do $$
declare
  v_id uuid;
begin
  v_id := public.agent_capture_lead(
    current_setting('test.conv')::uuid, 'Sam Prospect', 'sam@x.com', 'Prefers 6am');
  if v_id <> current_setting('test.lead')::uuid then
    raise exception 'second capture created a new lead';
  end if;
end $$;

select is(
  (select count(*)::int from public.leads
   where gym_id = current_setting('test.gym')::uuid),
  1,
  'a repeat capture dedups on phone instead of inserting'
);
select is(
  (select email from public.leads where id = current_setting('test.lead')::uuid),
  'sam@x.com',
  'a later capture backfills the email'
);
select is(
  (select count(*)::int from public.lead_sources
   where gym_id = current_setting('test.gym')::uuid
     and lower(label) = 'ai front desk' and archived_at is null),
  1,
  'the AI front desk source exists exactly once'
);

-- 8-9. Handoff: thread pauses, the assigned coach is notified, and the
-- reason lands on the lead's notes.
do $$ begin
  perform public.agent_request_handoff(
    current_setting('test.conv')::uuid, 'Asked about cancelling an old membership');
end $$;

select is(
  (select status from public.agent_conversations
   where id = current_setting('test.conv')::uuid),
  'handed_off',
  'handoff pauses the agent on the thread'
);
select is(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.lead')::uuid
     and idempotency_key like '%agent-handoff%'),
  2,
  'handoff enqueues in-app + email for the assigned coach'
);

-- 10. Internal only: an authenticated caller cannot execute the capture RPC.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  $$ select public.agent_capture_lead(current_setting('test.conv')::uuid, 'X', null, null) $$,
  '%permission denied%',
  'agent_capture_lead is not callable by authenticated users'
);

select * from finish();
rollback;
