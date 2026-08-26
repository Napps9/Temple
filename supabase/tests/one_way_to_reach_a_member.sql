-- 0271: the general member channel. Who gets a row on which channel, and
-- what STOP actually does.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@reach.test');
  v_a     uuid := _test_mk_user('ann@reach.test');
  v_b     uuid := _test_mk_user('ben@reach.test');
  v_gym   uuid := _test_mk_gym('Reach Gym', 'reach-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  -- The gym has a number that can text.
  insert into public.gym_agent_settings (gym_id, enabled, phone_number, sms_capable)
  values (v_gym, true, '+447700900123', true);

  -- Ann is set up end to end: number on file, opted in.
  insert into public.member_contact_details (profile_id, phone, phone_e164)
  values (v_a, '07717 503791', '+447717503791');
  update public.gym_memberships set sms_opt_in = true
   where gym_id = v_gym and profile_id = v_a;

  -- Ben has a number but never asked to be texted.
  insert into public.member_contact_details (profile_id, phone, phone_e164)
  values (v_b, '07700 900999', '+447700900999');

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ann', v_a::text, false);
  perform set_config('test.ben', v_b::text, false);
end $$;

-- 1-3. Ann gets both channels.
select is(
  public._enqueue_member_message(
    current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
    'personal_best', 'New best', 'Back squat 105 kg — up from 102.5.', 'k1'),
  2,
  'a member who asked gets an email and a text'
);
select is(
  (select count(*)::int from public.member_outbound_messages
    where profile_id = current_setting('test.ann')::uuid and channel = 'sms'),
  1,
  'the text is queued'
);
-- The address is deliberately absent: staff capabilities for reading an
-- email and a phone are separate from anything that reads this table.
select ok(
  not exists (
    select 1 from public.member_outbound_messages
    where body like '%+44%' or coalesce(subject, '') like '%+44%'
  ),
  'the row never carries the number it will be sent to'
);

-- 4-5. Ben gets email only — no opt-in means no text at all, not a
-- skipped row per member per message.
select is(
  public._enqueue_member_message(
    current_setting('test.gym')::uuid, current_setting('test.ben')::uuid,
    'personal_best', 'New best', 'Deadlift 180 kg — up from 175.', 'k2'),
  1,
  'a member who never opted in gets email only'
);
select is(
  (select count(*)::int from public.member_outbound_messages
    where profile_id = current_setting('test.ben')::uuid and channel = 'sms'),
  0,
  'and no text row is written at all'
);

-- 6. The same milestone enqueued twice is one message.
select is(
  public._enqueue_member_message(
    current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
    'personal_best', 'New best', 'Back squat 105 kg — up from 102.5.', 'k1'),
  0,
  'the same key twice sends nothing twice'
);

-- 7-9. STOP: consent off, and the queued text goes with it.
select is(
  public.member_stop_texts(current_setting('test.gym')::uuid, '07717503791'),
  1,
  'STOP from a member turns their opt-in off'
);
select is(
  (select sms_opt_in from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.ann')::uuid),
  false,
  'the opt-in is actually cleared'
);
select is(
  (select status from public.member_outbound_messages
    where profile_id = current_setting('test.ann')::uuid and channel = 'sms'),
  'skipped',
  'a text already written for them is not sent anyway'
);

-- 10. A member reads their own and nobody else's.
select _test_act_as(current_setting('test.ben')::uuid);
select is(
  (select count(*)::int from public.member_outbound_messages),
  1,
  'a member sees only their own messages'
);

select * from finish();
rollback;
