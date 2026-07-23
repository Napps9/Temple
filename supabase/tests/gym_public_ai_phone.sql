-- gym_public_ai_phone (0162): SECURITY DEFINER, so the two things that
-- actually matter are (1) it stays gated behind the site being
-- published, same as every other gym_public_* RPC, and (2) it only ever
-- surfaces a number the front desk will actually answer with — not one
-- that's merely provisioned but switched off, or voice-disabled.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@aiphone.test');
  v_gym   uuid := _test_mk_gym('AI Phone Gym', 'ai-phone-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.gym_agent_settings (gym_id, enabled, voice_enabled, phone_number)
    values (v_gym, true, true, '+447700900123');

  perform set_config('test.gym', v_gym::text, true);
end $$;

-- 1. No published site yet — nothing returned even though the front
-- desk is fully live.
select is(
  (select count(*)::int from public.gym_public_ai_phone('ai-phone-gym')),
  0,
  'gym_public_ai_phone returns nothing before the site is published'
);

-- 2. Publish the site (bypasses RLS as the test superuser).
do $$ begin
  insert into public.gym_websites (gym_id, published)
    values (current_setting('test.gym')::uuid, true);
end $$;

-- 3. Published and fully live — the number shows up.
select is(
  (select phone_number from public.gym_public_ai_phone('ai-phone-gym')),
  '+447700900123',
  'gym_public_ai_phone surfaces the number once published and fully live'
);

-- 4. Voice answering turned off — the block goes quiet even though the
-- number is still assigned and the site is still published.
do $$ begin
  update public.gym_agent_settings
    set voice_enabled = false
    where gym_id = current_setting('test.gym')::uuid;
end $$;
select is(
  (select count(*)::int from public.gym_public_ai_phone('ai-phone-gym')),
  0,
  'gym_public_ai_phone hides the number once voice answering is off'
);

-- 5. Front desk fully off — also nothing, even with voice re-enabled.
do $$ begin
  update public.gym_agent_settings
    set voice_enabled = true, enabled = false
    where gym_id = current_setting('test.gym')::uuid;
end $$;
select is(
  (select count(*)::int from public.gym_public_ai_phone('ai-phone-gym')),
  0,
  'gym_public_ai_phone hides the number once the front desk is disabled'
);

select * from finish();
rollback;
