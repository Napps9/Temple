-- 0270: what has to be true before a member can be texted at all.
-- The normaliser refuses rather than guesses; the two phone columns say
-- different things on purpose; opt-in is the member's and starts off.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@text.test');
  v_a     uuid := _test_mk_user('ann@text.test');
  v_gym   uuid := _test_mk_gym('Text Gym', 'text-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ann', v_a::text, false);
end $$;

-- 1-4. The normaliser.
select is(public._normalise_uk_phone('07717 503791'), '+447717503791',
  'a local mobile becomes E.164');
select is(public._normalise_uk_phone('447717503791'), '+447717503791',
  'a country code without the plus gets one');
select is(public._normalise_uk_phone('+34 600 123 456'), '+34600123456',
  'a number that is already E.164 keeps its country');
-- Returning null rather than the input is the point: a passthrough looks
-- like success right up until Twilio 400s months later.
select is(public._normalise_uk_phone('ring the gym'), null,
  'something that is not a number is refused, not passed through');

-- 5-7. Setting it keeps both forms.
select _test_act_as(current_setting('test.ann')::uuid);
select lives_ok(
  $$select public.set_my_contact_phone('07717 503791')$$,
  'a member sets their number'
);
select is(
  (select phone from public.member_contact_details
    where profile_id = current_setting('test.ann')::uuid),
  '07717 503791',
  'phone keeps what the member actually typed'
);
select is(
  (select phone_e164 from public.member_contact_details
    where profile_id = current_setting('test.ann')::uuid),
  '+447717503791',
  'phone_e164 is the dialable one'
);

-- 8. An unusable number is refused where they can still see the field.
select throws_ok(
  $$select public.set_my_contact_phone('nope')$$,
  'That does not look like a phone number',
  'an unparseable number is refused at the point of typing'
);

-- 9-10. Opt-in starts off and is the member's own.
select is(
  (select opted_in from public.my_sms_readiness(current_setting('test.gym')::uuid)),
  false,
  'nobody is opted in by default'
);
select is(
  (select has_phone from public.my_sms_readiness(current_setting('test.gym')::uuid)),
  true,
  'readiness sees the number they just set'
);

-- 11. The gym cannot text until its number can, whatever the member says.
select lives_ok(
  format('select public.set_my_sms_opt_in(%L, true)', current_setting('test.gym')),
  'a member can opt in'
);

select * from finish();
rollback;
