-- Objection handling + cold-lead signal (0150) and its hardening (0151):
-- agent_record_objection stores a fixed category label (never free text),
-- skips terminal leads, sets the chase clock; flag_stale_leads flags inactive
-- leads but skips opted-out ones; set_lead_status / clear_lead_follow_up clear
-- the chase.

begin;
select plan(13);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@obj.test');
  v_coach   uuid := _test_mk_user('coach@obj.test');
  v_member  uuid := _test_mk_user('member@obj.test');
  v_gym     uuid := _test_mk_gym('Objection Gym', 'objection-gym');
  v_lead1   uuid;
  v_stale   uuid;
  v_active  uuid;
  v_optout  uuid;
  v_conv    uuid;
  v_aconv   uuid;
  v_oconv   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id)
  values (v_gym, 'Warm Lead', '+447700900970', 'contacted', v_coach)
  returning id into v_lead1;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900970', 'voice', v_lead1) returning id into v_conv;

  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id,
                            captured_at, updated_at)
  values (v_gym, 'Gone Quiet', '+447700900971', 'contacted', v_coach,
          now() - interval '20 days', now() - interval '20 days')
  returning id into v_stale;

  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id,
                            captured_at, updated_at)
  values (v_gym, 'Still Texting', '+447700900972', 'contacted', v_coach,
          now() - interval '20 days', now() - interval '20 days')
  returning id into v_active;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (v_gym, '+447700900972', 'sms', v_active) returning id into v_aconv;
  insert into public.agent_messages (conversation_id, gym_id, role, body, created_at)
  values (v_aconv, v_gym, 'lead', 'still keen, been busy', now() - interval '1 day');

  -- Opted out (STOP → closed conversation), old and quiet: must NOT be chased.
  insert into public.leads (gym_id, full_name, phone, status, assigned_coach_id,
                            captured_at, updated_at)
  values (v_gym, 'Opted Out', '+447700900973', 'contacted', v_coach,
          now() - interval '20 days', now() - interval '20 days')
  returning id into v_optout;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id, status)
  values (v_gym, '+447700900973', 'sms', v_optout, 'closed') returning id into v_oconv;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.lead1',  v_lead1::text,  true);
  perform set_config('test.conv',   v_conv::text,   true);
  perform set_config('test.stale',  v_stale::text,  true);
  perform set_config('test.active', v_active::text, true);
  perform set_config('test.optout', v_optout::text, true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
end $$;

-- 1-2. 'considering' records the category label and leaves the chase clock alone.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'price', 'considering');
end $$;
select is(
  (select objection from public.leads where id = current_setting('test.lead1')::uuid),
  'Price / cost',
  'the objection category is stored as a fixed label, not free text'
);
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) is null,
  'considering does not set a chase date'
);

-- 3. An unknown/garbage category falls back to Other (no free text leaks).
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'nervous about my knee', 'considering');
end $$;
select is(
  (select objection from public.leads where id = current_setting('test.lead1')::uuid),
  'Other',
  'a non-category string is coerced to Other — no verbatim text is stored'
);

-- 4. 'deferred' schedules a chase in the future.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'nerves', 'deferred');
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.lead1')::uuid) > now(),
  'deferred schedules a future follow-up'
);

-- 5-6. 'declined' flags it due now and notifies the coach.
do $$ begin
  perform public.agent_record_objection(
    current_setting('test.conv')::uuid, 'comparing', 'declined');
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

-- 7. A converted lead is left untouched (the agent never re-flags a member).
do $$
declare v_c uuid; v_conv_c uuid;
begin
  insert into public.leads (gym_id, full_name, phone, status, converted_at, converted_profile_id)
  values (current_setting('test.gym')::uuid, 'Already Member', '+447700900974', 'converted',
          now(), current_setting('test.member')::uuid)
  returning id into v_c;
  insert into public.agent_conversations (gym_id, phone, channel, lead_id)
  values (current_setting('test.gym')::uuid, '+447700900974', 'sms', v_c) returning id into v_conv_c;
  perform public.agent_record_objection(v_conv_c, 'price', 'declined');
  perform set_config('test.converted', v_c::text, true);
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.converted')::uuid) is null
  and (select objection from public.leads where id = current_setting('test.converted')::uuid) is null,
  'a converted lead is never re-flagged or annotated by the agent'
);

-- 8-10. The stale sweep flags the quiet lead and notifies, but skips both the
-- recently-active lead and the opted-out one.
do $$ begin perform public.flag_stale_leads(); end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.stale')::uuid) is not null,
  'a lead inactive for a week is flagged for follow-up'
);
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.active')::uuid) is null,
  'a lead with a recent inbound message is not flagged stale'
);
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.optout')::uuid) is null,
  'an opted-out (closed-conversation) lead is never chased'
);

-- 11. The stale lead notified its coach.
select cmp_ok(
  (select count(*)::int from public.lead_notifications
   where lead_id = current_setting('test.stale')::uuid
     and idempotency_key like '%stale-lead%'),
  '>=', 1,
  'the stale lead notifies its coach'
);

-- 12. Acting on the lead (clear_lead_follow_up) retires the chase.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$ begin
  perform public.clear_lead_follow_up(current_setting('test.stale')::uuid);
end $$;
select ok(
  (select follow_up_at from public.leads where id = current_setting('test.stale')::uuid) is null,
  'clear_lead_follow_up retires the chase flag'
);

-- 13. agent_record_objection is service-role only.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select public.agent_record_objection(%L::uuid, 'price', 'declined') $$,
         current_setting('test.conv')),
  '%permission denied%',
  'agent_record_objection is not callable by authenticated users'
);

select * from finish();
rollback;
