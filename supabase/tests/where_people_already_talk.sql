-- 0275: WhatsApp is a third channel on the same conversation table, and
-- the address prefix never reaches the database.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wa.test');
  v_gym   uuid := _test_mk_gym('WA Gym', 'wa-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.gym_agent_settings (gym_id, enabled, phone_number)
  values (v_gym, true, '+447700900123');
  perform set_config('test.gym', v_gym::text, false);
end $$;

-- 1-2. All three channels are accepted now.
select lives_ok(
  format($q$insert into public.agent_conversations (gym_id, phone, channel)
    values (%L, '+447717503791', 'whatsapp')$q$, current_setting('test.gym')),
  'a WhatsApp conversation can exist'
);
select lives_ok(
  format($q$insert into public.agent_conversations (gym_id, phone, channel)
    values (%L, '+447717503791', 'sms')$q$, current_setting('test.gym')),
  'and the same person on SMS is a separate thread'
);

-- 3. Which is the point of the (gym, phone, channel) key: one person,
--    two channels, two threads, and neither overwrites the other.
select is(
  (select count(*)::int from public.agent_conversations
    where gym_id = current_setting('test.gym')::uuid
      and phone = '+447717503791'),
  2,
  'one person on two channels keeps two threads'
);

-- 4. A fourth channel is still refused — the CHECK was widened, not dropped.
select throws_ok(
  format($q$insert into public.agent_conversations (gym_id, phone, channel)
    values (%L, '+447717503792', 'telegram')$q$, current_setting('test.gym')),
  23514,
  null,
  'an unknown channel is still refused'
);

-- 5-6. The prefix must never be stored: everything that matches a person
--      across the product matches on E.164.
select is(
  (select count(*)::int from public.agent_conversations
    where phone like 'whatsapp:%'),
  0,
  'no conversation carries the wire prefix'
);
select is(
  (select public._normalise_uk_phone('+447717503791')),
  '+447717503791',
  'and the number is the same shape lead matching uses'
);

select * from finish();
rollback;
