-- Lead consent (0108): capture_public_lead records marketing consent +
-- lawful basis on the lead, and only stamps consent_at when the prospect
-- actually opts in.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@consent.test');
  v_coach uuid := _test_mk_user('coach@consent.test');
  v_gym uuid := _test_mk_gym('Consent Gym', 'consent-gym');
  v_off uuid := _test_mk_gym('Consent Off Gym', 'consent-off');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_off, v_owner, 'owner');
  update public.gyms set public_lead_capture_enabled = true where id = v_gym;
  perform set_config('test.gym', v_gym::text, true);
end $$;

-- A prospect who ticks the marketing box.
do $$ begin
  perform capture_public_lead('consent-gym', 'Consenting Prospect',
    'yes@prospect.test', null, 'Interested in classes', true);
end $$;

-- 1-3. Consent captured with basis + timestamp.
select is(
  (select marketing_consent from public.leads where lower(email) = 'yes@prospect.test'),
  true,
  'a ticked marketing box records marketing_consent = true');
select isnt(
  (select consent_at from public.leads where lower(email) = 'yes@prospect.test'),
  null,
  'consent_at is stamped when the prospect opts in');
select is(
  (select lawful_basis from public.leads where lower(email) = 'yes@prospect.test'),
  'legitimate_interest',
  'the enquiry record itself rests on legitimate interest');

-- A prospect who does not tick the box.
do $$ begin
  perform capture_public_lead('consent-gym', 'Quiet Prospect',
    'no@prospect.test', null, null, false);
end $$;

-- 4-5. No consent, no timestamp.
select is(
  (select marketing_consent from public.leads where lower(email) = 'no@prospect.test'),
  false,
  'no tick means marketing_consent stays false');
select is(
  (select consent_at from public.leads where lower(email) = 'no@prospect.test'),
  null,
  'consent_at stays null without an opt-in');

-- 6. Capture is refused on a gym that has not opted into public capture.
select throws_like(
  'select capture_public_lead(''consent-off'', ''Nope'', ''x@prospect.test'', null, null, false)',
  '%not accepting enquiries%',
  'capture is refused when public lead capture is disabled');

select * from finish();
rollback;
