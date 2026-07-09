-- Under-18 handling: allow_minors is owner-gated and off by default, and
-- record_consent enforces it server-side from profiles.date_of_birth —
-- blocking a minor until the gym opts in, then recording the guardian's
-- consent as the lawful basis.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@minors.test');
  v_kid   uuid := _test_mk_user('kid@minors.test');   -- 12
  v_adult uuid := _test_mk_user('adult@minors.test'); -- 30
  v_gym   uuid := _test_mk_gym('Minors Gym', 'minors');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_kid,   'member');
  perform _test_mk_membership(v_gym, v_adult, 'member');

  update public.profiles set date_of_birth = (current_date - interval '12 years')::date
    where id = v_kid;
  update public.profiles set date_of_birth = (current_date - interval '30 years')::date
    where id = v_adult;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.kid',   v_kid::text,   true);
  perform set_config('test.adult', v_adult::text, true);
end $$;

-- 1. Off by default.
select is(
  (select allow_minors from public.gyms where id = current_setting('test.gym')::uuid),
  false,
  'allow_minors defaults to false'
);

-- 2. Only an owner can flip it.
do $$ begin perform _test_act_as(current_setting('test.kid')::uuid); end $$;
select throws_ok(
  format('select set_allow_minors(%L::uuid, true)', current_setting('test.gym')),
  'Only an owner can change this setting',
  'set_allow_minors is owner-gated'
);

-- 3. An under-18 member is blocked while the gym disallows minors.
do $$ begin perform _test_act_as(current_setting('test.kid')::uuid); end $$;
select throws_like(
  format('select record_consent(%L::uuid, %L)', current_setting('test.gym'), '2026-07'),
  '%does not accept members under 18%',
  'record_consent blocks an under-18 when allow_minors is false'
);

-- 4. An adult is unaffected.
do $$ begin perform _test_act_as(current_setting('test.adult')::uuid); end $$;
select lives_ok(
  format('select record_consent(%L::uuid, %L)', current_setting('test.gym'), '2026-07'),
  'record_consent works for an adult regardless of the setting'
);

-- 5. Owner opts in.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform set_allow_minors(current_setting('test.gym')::uuid, true);
end $$;
select is(
  (select allow_minors from public.gyms where id = current_setting('test.gym')::uuid),
  true,
  'owner can enable allow_minors'
);

-- 6. The minor can now consent with guardian details, recorded as
--    parental_consent.
do $$
begin
  perform _test_act_as(current_setting('test.kid')::uuid);
  perform record_consent(
    current_setting('test.gym')::uuid, '2026-07', 'consent',
    'Parent Name', 'parent@x.test');
end $$;
select is(
  (select lawful_basis from public.member_consents
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.kid')::uuid
       and policy_version = '2026-07'),
  'parental_consent',
  'a minor''s consent with guardian details is recorded as parental_consent'
);

select * from finish();
rollback;
