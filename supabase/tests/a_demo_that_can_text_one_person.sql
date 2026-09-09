-- 0290: the one destination a demo gym may really text.
--
-- The property 0278 was defending is that somebody holding the published
-- demo password cannot reach a stranger. These tests are that property
-- restated per-destination: a named handset rings, everything else still
-- simulates, and an entry stops working when it runs out.
--
-- The session sets request.jwt.claim.sub without switching role, because
-- user_is_owner_of reads auth.uid() and nothing else. That keeps the
-- ownership check under test while leaving the session able to call
-- demo_sms_allowed, which is service-role only by design.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@demotext.test');
  v_coach uuid := _test_mk_user('coach@demotext.test');
  v_demo  uuid := _test_mk_gym('Demo Gym', 'demo-can-text-one-person');
  v_other uuid := _test_mk_gym('Other Demo', 'demo-someone-elses-list');
begin
  perform _test_mk_membership(v_demo, v_owner, 'owner');
  perform _test_mk_membership(v_demo, v_coach, 'coach');
  perform set_config('test.demo',  v_demo::text,  true);
  perform set_config('test.other', v_other::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1. The gym is still a demo gym. Nothing here trades that away.
select is(
  (select is_demo from public.gyms where id = current_setting('test.demo')::uuid),
  true,
  'the tenant is still flagged demo'
);

-- 2. Nothing is allowed until somebody says so.
select ok(
  not public.demo_sms_allowed(current_setting('test.demo')::uuid, '07717 503791'),
  'no handset is allowed by default'
);

-- 3-5. The owner adds one, as it would be said out loud.
do $$ begin
  perform set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
end $$;
select lives_ok(
  $$select public.allow_demo_sms_number(
      current_setting('test.demo')::uuid, '07717 503791', 'Nick, sales calls')$$,
  'an owner allows a handset'
);
select is(
  (select phone from public.demo_sms_allowlist
   where gym_id = current_setting('test.demo')::uuid),
  '+447717503791',
  'it is stored dialable, not as it was typed'
);
select ok(
  public.demo_sms_allowed(current_setting('test.demo')::uuid, '+447717503791')
  and public.demo_sms_allowed(current_setting('test.demo')::uuid, '07717503791'),
  'the allowed handset matches however the sender spells it'
);

-- 6. The whole point: a number nobody named is still refused. That is the
--    stranger 0278 exists to protect.
select ok(
  not public.demo_sms_allowed(current_setting('test.demo')::uuid, '07900 111222'),
  'a handset nobody named is still refused'
);

-- 7. And it is per gym — one demo tenant's list is not another's.
select ok(
  not public.demo_sms_allowed(current_setting('test.other')::uuid, '07717 503791'),
  'an allowance does not leak to another demo tenant'
);

-- 8. Expiry is the self-closing half: an entry that has run out reads
--    exactly like one nobody ever added.
do $$ begin
  update public.demo_sms_allowlist
     set expires_at = now() - interval '1 minute'
   where gym_id = current_setting('test.demo')::uuid;
end $$;
select ok(
  not public.demo_sms_allowed(current_setting('test.demo')::uuid, '07717 503791'),
  'an expired allowance stops working'
);

-- 9. A number that cannot be dialled is refused where somebody is looking
--    at it, rather than stored and silently never matching at send time.
select throws_like(
  $$select public.allow_demo_sms_number(
      current_setting('test.demo')::uuid, 'ring me', null)$$,
  '%does not look like a phone number%',
  'an unparseable number is refused on the way in'
);

-- 10. Only an owner. A coach cannot widen what the tenant may reach.
do $$ begin
  perform set_config('request.jwt.claim.sub', current_setting('test.coach'), true);
end $$;
select throws_like(
  $$select public.allow_demo_sms_number(
      current_setting('test.demo')::uuid, '07900 111222', null)$$,
  '%Only an owner%',
  'a coach cannot allow a handset'
);

select * from finish();
rollback;
