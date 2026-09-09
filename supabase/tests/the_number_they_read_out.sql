-- 0289: the number a caller says out loud, and the cap on texting it.
-- Caller ID stays authoritative where there is one; the sentinel a
-- browser call carries never reaches leads.phone; a dictated destination
-- is bounded per gym per day like a dictated email address is.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@said.test');
  v_coach uuid := _test_mk_user('coach@said.test');
  v_gym   uuid := _test_mk_gym('Said Gym', 'said-gym');
  v_web   uuid;
  v_sms   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  -- The two shapes a voice conversation comes in: a browser call with no
  -- caller ID at all, and a call that arrived from a real handset.
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, 'web-test', 'voice') returning id into v_web;
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900123', 'voice') returning id into v_sms;
  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.web',  v_web::text,  true);
  perform set_config('test.sms',  v_sms::text,  true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1-2. A browser call: the number they read out is the lead's number,
-- normalised, and the conversation's sentinel goes nowhere near it.
do $$
declare
  v_id uuid;
begin
  v_id := public.agent_capture_lead(
    current_setting('test.web')::uuid, 'Nick Prospect', null, 'Wants 7am',
    '07717 503791');
  perform set_config('test.lead', v_id::text, true);
end $$;

select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  '+447717503791',
  'the number the caller said becomes the lead phone, in E.164'
);
select is(
  (select count(*)::int from public.leads
   where gym_id = current_setting('test.gym')::uuid and phone = 'web-test'),
  0,
  'the browser sentinel is never written as a phone number'
);

-- 3. A second capture on the same call folds into the same lead by that
-- number rather than starting another one.
select is(
  public.agent_capture_lead(
    current_setting('test.web')::uuid, 'Nick Prospect', 'nick@x.com', null,
    '+447717503791'),
  current_setting('test.lead')::uuid,
  'a repeat capture dedups on the number that was said'
);

-- 4. Caller ID wins: a caller who dictates a different number does not
-- get the lead written against it.
do $$
declare
  v_id uuid;
begin
  v_id := public.agent_capture_lead(
    current_setting('test.sms')::uuid, 'Sam Caller', null, null, '07900 111222');
  perform set_config('test.caller', v_id::text, true);
end $$;

select is(
  (select phone from public.leads where id = current_setting('test.caller')::uuid),
  '+447700900123',
  'the number they called from beats the number they dictated'
);

-- 5. Nothing dialable anywhere: a null phone, not a guess and not a
-- sentinel. The lead is still captured — a name and a coach is the point.
do $$
declare
  v_conv uuid;
  v_id   uuid;
begin
  insert into public.agent_conversations (gym_id, phone, channel)
  values (current_setting('test.gym')::uuid, 'web-test', 'sms')
  returning id into v_conv;
  v_id := public.agent_capture_lead(v_conv, 'Nameless Only', null, null, 'ring the gym');
  perform set_config('test.nophone', v_id::text, true);
end $$;

select is(
  (select phone from public.leads where id = current_setting('test.nophone')::uuid),
  null,
  'an unparseable number leaves the lead phone null'
);

-- 6-9. The send cap: three to a number in a day, then no more, and a
-- different number is unaffected.
select ok(
  public.agent_sms_send_allowed(current_setting('test.web')::uuid, '07717 503791'),
  'the first agent text to a number is allowed'
);
select ok(
  public.agent_sms_send_allowed(current_setting('test.web')::uuid, '+447717503791')
  and public.agent_sms_send_allowed(current_setting('test.web')::uuid, '07717503791'),
  'the cap counts the same number however it is written'
);
select ok(
  not public.agent_sms_send_allowed(current_setting('test.web')::uuid, '07717 503791'),
  'the fourth text to that number in a day is refused'
);
select ok(
  public.agent_sms_send_allowed(current_setting('test.web')::uuid, '07900 111222'),
  'a different number still has its own allowance'
);

-- 10. A number that cannot be dialled is refused rather than recorded.
select ok(
  not public.agent_sms_send_allowed(current_setting('test.web')::uuid, 'call me back'),
  'a destination that is not a number is refused'
);

-- 11. Internal only, like every other agent RPC.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  $$ select public.agent_sms_send_allowed(current_setting('test.web')::uuid, '07717 503791') $$,
  '%permission denied%',
  'agent_sms_send_allowed is not callable by authenticated users'
);

select * from finish();
rollback;
