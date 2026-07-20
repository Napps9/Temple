-- Objection handling + cold-lead signal (0150): agent_record_objection sets
-- the concern and the chase clock, flag_stale_leads flags inactive leads and
-- notifies, and set_lead_status clears the chase when staff act.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@obj.test');
  v_coach  uuid := _test_mk_user('coach@obj.test');
  v_gym    uuid := _test_mk_gym('Objection Gym', 'objection-gym');
  v_lead1  uuid;
  v_stale  uuid;
  v_active uuid;
  v_conv   uuid;
  v_aconv  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id)
  values (v_gym, 'Warm Lead', '+447700900970', 'contacted', v_coach)
  returning id into v_lead1;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900970', 'voice', v_lead1) returning id into v_conv;

  -- Stale: old activity, no recent messages.
  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id,
                            captured_at, updated_at)
  values (v_gym, 'Gone Quiet', '+447700900971', 'contacted', v_coach,
          now() - interval '20 days', now() - interval '20 days')
  returning id into v_stale;

  -- Also old, but a message arrived yesterday — must NOT be flagged.
  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id,
                            captured_at, updated_at)
  values (v_gym, 'Still Texting', '+447700900972', 'contacted', v_coach,
          now() - interval '20 days', now() - interval '20 days')
  returning id into v_active;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900972', 'sms', v_active) returning id into v_aconv;
  insert into public.agent_messages (conversation_id, gym_id, role, body, created_at)
  values (v_aconv, v_gym, 'lead', 'still keen, been busy', now() - interval '1 day');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.lead1',  v_lead1::text,  true);
  perform set_config('test.conv',   v_conv::text,   true);
  perform set_config('test.stale',  v_stale::text,  true);
  perform set_config('test.active', v_active::text, true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
end $$;

-- 1-2. 'considering' records the concern and leaves the chase clock alone.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'price too high', 'considering');
end $$;
select is(
  (select objection from public.leads where id = current_setting('test.lead1')::uuid),
  'price too high',
  'the objection reason is recorded on the lead'
);
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) is null,
  'considering does not set a chase date'
);

-- 3. 'deferred' schedules a chase in the future.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'wants to think it over', 'deferred');
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) > now(),
  'deferred schedules a future follow-up'
);

-- 4-5. 'declined' flags it due now and notifies the coach.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'joined a cheaper gym', 'declined');
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) <= now(),
  'declined flags the lead due now'
);
select cmp_ok(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.lead1')::uuid
     and idempotency_key like '%lead-cooled%'),
  '>=', 1,
  'a cooled lead notifies the coach'
);

-- 6-8. The stale sweep flags the quiet lead and notifies, but leaves the
-- lead that texted yesterday alone.
do $$ begin perform public.flag_stale_leads(); end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.stale')::uuid) is not null,
  'a lead inactive for a week is flagged for follow-up'
);
select cmp_ok(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.stale')::uuid
     and idempotency_key like '%stale-lead%'),
  '>=', 1,
  'the stale lead notifies its coach'
);
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.active')::uuid) is null,
  'a lead with a recent inbound message is not flagged stale'
);

-- 9. Acting on the lead (status change) clears the chase.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$ begin
  perform public.set_lead_status(current_setting('test.lead1')::uuid, 'intro_booked', null);
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) is null,
  'set_lead_status clears the follow-up flag'
);

-- 10. agent_record_objection is service-role only.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select public.agent_record_objection(%L::uuid, 'x', 'declined') $$,
         current_setting('test.conv')),
  '%permission denied%',
  'agent_record_objection is not callable by authenticated users'
);

select * from finish();
rollback;
