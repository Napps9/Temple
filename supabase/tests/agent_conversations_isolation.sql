-- agent_conversations / agent_messages (0136): tenant-scoped read via
-- user_can_assign_plan, no client writes.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_coach_a uuid := _test_mk_user('coach-a@agconv.test');
  v_member_a uuid := _test_mk_user('member-a@agconv.test');
  v_owner_b uuid := _test_mk_user('owner-b@agconv.test');
  v_gym_a   uuid := _test_mk_gym('Conv Gym A', 'conv-a');
  v_gym_b   uuid := _test_mk_gym('Conv Gym B', 'conv-b');
  v_conv_a  uuid;
  v_conv_b  uuid;
begin
  perform _test_mk_membership(v_gym_a, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym_a, v_member_a, 'member');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');

  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym_a, '+447700900001', 'sms') returning id into v_conv_a;
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym_b, '+447700900002', 'sms') returning id into v_conv_b;
  insert into public.agent_messages (conversation_id, gym_id, role, body)
  values (v_conv_a, v_gym_a, 'lead', 'Hi, how much is membership?'),
         (v_conv_a, v_gym_a, 'agent', 'Great question — plans start at...');

  perform set_config('test.gym_a',  v_gym_a::text,  true);
  perform set_config('test.conv_a', v_conv_a::text, true);
  perform set_config('test.coach_a', v_coach_a::text, true);
  perform set_config('test.member_a', v_member_a::text, true);
  perform set_config('test.owner_b', v_owner_b::text, true);
end $$;

-- 1-2. Gym A staff see their conversation and its messages.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_conversations
   where gym_id = current_setting('test.gym_a')::uuid),
  1,
  'gym staff can read their conversations'
);
select is(
  (select count(*)::int from public.agent_messages
   where conversation_id = current_setting('test.conv_a')::uuid),
  2,
  'gym staff can read the thread'
);

-- 3. Gym B's owner sees none of gym A's thread.
do $$ begin perform _test_act_as(current_setting('test.owner_b')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_conversations
   where gym_id = current_setting('test.gym_a')::uuid)
  + (select count(*)::int from public.agent_messages
     where conversation_id = current_setting('test.conv_a')::uuid),
  0,
  'another gym''s staff see neither conversations nor messages'
);

-- 4. A member sees nothing.
do $$ begin perform _test_act_as(current_setting('test.member_a')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_conversations
   where gym_id = current_setting('test.gym_a')::uuid),
  0,
  'a member sees no conversations'
);

-- 5. There is no client insert policy on messages.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;
select throws_like(
  $$ insert into public.agent_messages (conversation_id, gym_id, role, body)
     values (current_setting('test.conv_a')::uuid,
             current_setting('test.gym_a')::uuid, 'staff', 'sneaky') $$,
  '%row-level security%',
  'clients cannot insert messages directly'
);

select * from finish();
rollback;
