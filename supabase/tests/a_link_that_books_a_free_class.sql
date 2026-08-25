-- Trial passes (0262). The invariant the whole design rests on is the
-- first assertion: redeeming does NOT book. It holds a seat and records
-- intent; the waiver and PAR-Q are still signed by the person's own
-- hand, and the booking then goes through book_class as them.
--
-- The gym here requires membership to book, so the comp grant is
-- carrying the trialist past the 'Membership required' gate as well.

begin;
select plan(28);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@trialpass.test');
  v_coach    uuid := _test_mk_user('coach@trialpass.test');
  v_member   uuid := _test_mk_user('member@trialpass.test');
  v_prospect uuid := _test_mk_user('prospect@trialpass.test');
  v_second   uuid := _test_mk_user('second@trialpass.test');
  v_wrong    uuid := _test_mk_user('wrong@trialpass.test');
  v_back     uuid := _test_mk_user('backagain@trialpass.test');
  v_out      uuid := _test_mk_user('outsider@trialpass.test');
  v_gym      uuid := _test_mk_gym('Trial Pass Gym', 'trial-pass-gym');
  v_other    uuid := _test_mk_gym('Other Trial Gym', 'other-trial-gym');
  v_ct       uuid;
  v_sess     uuid;
  v_far      uuid;
  v_waiver   uuid;
  v_parq     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_other, v_out, 'owner');

  -- A coach who left, and is about to come back through a trial link.
  perform _test_mk_membership(v_gym, v_back, 'coach');
  update public.gym_memberships set left_at = now()
   where gym_id = v_gym and profile_id = v_back;

  -- The gate the comp grant has to defeat.
  update public.gyms set require_membership_to_book = true where id = v_gym;

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'Foundations', '#2563EB') returning id into v_ct;

  v_sess := _test_mk_session(v_gym, v_coach, now() + interval '2 days', 60, v_ct);
  v_far  := _test_mk_session(v_gym, v_coach, now() + interval '40 days', 60, v_ct);
  update public.class_sessions set capacity = 2 where id = v_sess;

  insert into public.waiver_documents (gym_id, version, file_path, file_url)
  values (v_gym, 1, 'g/w.pdf', 'https://example.test/w.pdf')
  returning id into v_waiver;

  insert into public.parq_questionnaires (gym_id, version)
  values (v_gym, 1) returning id into v_parq;

  -- The existing member has already done both, so they can stand in for
  -- "an ordinary booking" without the health screens in the way.
  insert into public.waiver_signatures (gym_id, profile_id, waiver_id, signature)
  values (v_gym, v_member, v_waiver, '{"paths":[]}'::jsonb);
  insert into public.parq_responses (gym_id, profile_id, questionnaire_id)
  values (v_gym, v_member, v_parq);
  -- ...and holds an entitlement, so a refusal to book reads 'Class is
  -- full' rather than 'Membership required'.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, credits_total, credits_remaining,
     granted_by, reason)
  values (v_gym, v_member, now(), now() + interval '90 days', 10, 10,
          v_owner, 'Fixture');

  perform set_config('test.gym',      v_gym::text,      false);
  perform set_config('test.other',    v_other::text,    false);
  perform set_config('test.coach',    v_coach::text,    false);
  perform set_config('test.member',   v_member::text,   false);
  perform set_config('test.prospect', v_prospect::text, false);
  perform set_config('test.second',   v_second::text,   false);
  perform set_config('test.wrong',    v_wrong::text,    false);
  perform set_config('test.back',     v_back::text,     false);
  perform set_config('test.out',      v_out::text,      false);
  perform set_config('test.ct',       v_ct::text,       false);
  perform set_config('test.sess',     v_sess::text,     false);
  perform set_config('test.far',      v_far::text,      false);
  perform set_config('test.waiver',   v_waiver::text,   false);
  perform set_config('test.parq',     v_parq::text,     false);
end $$;

-- 1. A coach can mint a public pass for one class.
select _test_act_as(current_setting('test.coach')::uuid);
select lives_ok(
  $$select public.create_trial_pass(
      current_setting('test.gym')::uuid, null,
      current_setting('test.sess')::uuid)$$,
  'a coach can mint a trial link for a class'
);

do $$
declare v_token text;
begin
  select token into v_token from public.trial_passes
   where session_id = current_setting('test.sess')::uuid
   order by created_at desc limit 1;
  perform set_config('test.token', v_token, false);
end $$;

-- 2. The whole design, in one assertion: redeeming does not book.
select _test_act_as(current_setting('test.prospect')::uuid);
select lives_ok(
  $$select public.redeem_trial_pass(current_setting('test.token')::text)$$,
  'a stranger can redeem the link'
);
select is(
  (select count(*)::int from public.class_bookings
    where profile_id = current_setting('test.prospect')::uuid),
  0,
  'redeeming books nothing — it holds the seat and records the intent'
);

-- 3. The seat is held, and the comp grant is the entitlement.
select is(
  (select count(*)::int from public.trial_pass_redemptions
    where profile_id = current_setting('test.prospect')::uuid
      and held_until > now() and booking_id is null),
  1,
  'the seat is held'
);
select is(
  (select credits_remaining from public.comp_grants
    where profile_id = current_setting('test.prospect')::uuid),
  1,
  'a one-class comp grant is issued'
);

-- 4. The health screening is still answered by them (it is the first
--    of the two gates _book_class_for applies).
select throws_ok(
  $$select public.book_class(current_setting('test.sess')::uuid)$$,
  'PAR-Q required: complete the health screening before booking',
  'the trialist still has to complete the health screening'
);
select lives_ok(
  $$insert into public.parq_responses (gym_id, profile_id, questionnaire_id)
    values (current_setting('test.gym')::uuid,
            current_setting('test.prospect')::uuid,
            current_setting('test.parq')::uuid)$$,
  'the trialist can answer the PAR-Q themselves'
);

-- 5. And the waiver is still signed by their own hand.
select throws_ok(
  $$select public.book_class(current_setting('test.sess')::uuid)$$,
  'Waiver required: sign the waiver before booking',
  'the trialist still has to sign the waiver'
);
select lives_ok(
  $$insert into public.waiver_signatures (gym_id, profile_id, waiver_id, signature)
    values (current_setting('test.gym')::uuid,
            current_setting('test.prospect')::uuid,
            current_setting('test.waiver')::uuid, '{"paths":[]}'::jsonb)$$,
  'the trialist can sign the waiver themselves'
);

-- 6. Now it books — on the comp, at a gym that requires membership.
select lives_ok(
  $$select public.book_class(current_setting('test.sess')::uuid)$$,
  'once the gates are satisfied the trial class books'
);
select is(
  (select used_entitlement_kind::text from public.class_bookings
    where profile_id = current_setting('test.prospect')::uuid),
  'comp_grant',
  'the booking spends the trial comp, not a plan'
);
select is(
  (select credits_remaining from public.comp_grants
    where profile_id = current_setting('test.prospect')::uuid),
  0,
  'the comp credit is burned exactly once'
);

-- 7. The window trap: a pass for a class 40 days out, valid 14 days,
--    must still produce a grant that covers the class it was minted
--    for — list_booking_entitlements tests the SESSION's start.
select _test_act_as(current_setting('test.coach')::uuid);
do $$
declare v_token text;
begin
  select t.token into v_token
    from public.create_trial_pass(
      current_setting('test.gym')::uuid, null,
      current_setting('test.far')::uuid, 1, 14) t;
  perform set_config('test.fartoken', v_token, false);
end $$;
select _test_act_as(current_setting('test.second')::uuid);
select lives_ok(
  $$select public.redeem_trial_pass(current_setting('test.fartoken')::text)$$,
  'a pass for a distant class redeems'
);
select ok(
  (select ends_at > (select starts_at from public.class_sessions
                      where id = current_setting('test.far')::uuid)
     from public.comp_grants
    where profile_id = current_setting('test.second')::uuid),
  'the comp window reaches the class it was minted for'
);
select is(
  (select count(*)::int
     from public.list_booking_entitlements(
       current_setting('test.far')::uuid,
       current_setting('test.second')::uuid) e
    where e.kind::text = 'comp_grant'),
  1,
  'and the booking picker offers it for that class'
);

-- 8. A held seat is an occupied seat for everybody else. The class has
--    capacity 2: one confirmed booking (the trialist, above) and one
--    live hold leaves nothing.
select _test_act_as(current_setting('test.coach')::uuid);
do $$
declare v_token text;
begin
  select t.token into v_token
    from public.create_trial_pass(
      current_setting('test.gym')::uuid, null,
      current_setting('test.sess')::uuid) t;
  perform set_config('test.holdtoken', v_token, false);
end $$;
select _test_act_as(current_setting('test.wrong')::uuid);
select lives_ok(
  $$select public.redeem_trial_pass(current_setting('test.holdtoken')::text)$$,
  'a second stranger claims the last seat'
);
select _test_act_as(current_setting('test.member')::uuid);
select throws_ok(
  $$select public.book_class(current_setting('test.sess')::uuid)$$,
  'Class is full',
  'a held seat counts against capacity for everyone else'
);

-- 9. But never against the holder. Same class, same moment: the person
--    holding the seat can take it.
select _test_act_as(current_setting('test.wrong')::uuid);
select lives_ok(
  $$insert into public.waiver_signatures (gym_id, profile_id, waiver_id, signature)
    values (current_setting('test.gym')::uuid,
            current_setting('test.wrong')::uuid,
            current_setting('test.waiver')::uuid, '{"paths":[]}'::jsonb);
    insert into public.parq_responses (gym_id, profile_id, questionnaire_id)
    values (current_setting('test.gym')::uuid,
            current_setting('test.wrong')::uuid,
            current_setting('test.parq')::uuid);
    select public.book_class(current_setting('test.sess')::uuid)$$,
  'the holder is not locked out of the seat they are holding'
);

-- 10. Redeeming twice is idempotent, not an error.
select _test_act_as(current_setting('test.prospect')::uuid);
select lives_ok(
  $$select public.redeem_trial_pass(current_setting('test.token')::text)$$,
  'a second tap on the same link is idempotent'
);
select is(
  (select count(*)::int from public.trial_pass_redemptions
    where profile_id = current_setting('test.prospect')::uuid),
  1,
  'and leaves exactly one redemption'
);

-- 11. A returning coach comes back as a coach, not demoted to member.
select _test_act_as(current_setting('test.coach')::uuid);
do $$
declare v_token text;
begin
  select t.token into v_token
    from public.create_trial_pass(
      current_setting('test.gym')::uuid,
      current_setting('test.ct')::uuid) t;
  perform set_config('test.cttoken', v_token, false);
end $$;
select _test_act_as(current_setting('test.back')::uuid);
select lives_ok(
  $$select public.redeem_trial_pass(
      current_setting('test.cttoken')::text,
      current_setting('test.far')::uuid)$$,
  'a former coach can redeem a class-type link'
);
select is(
  (select role::text from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.back')::uuid),
  'coach',
  'reopening a membership does not demote a returning coach'
);

-- 12. A revoked link is gone, and the offer says nothing about it.
select _test_act_as(current_setting('test.coach')::uuid);
do $$
declare v_pass uuid;
begin
  select id into v_pass from public.trial_passes
   where token = current_setting('test.cttoken');
  perform public.revoke_trial_pass(v_pass);
end $$;
select is(
  (select count(*)::int from public.trial_pass_offer(
     current_setting('test.cttoken')::text)),
  0,
  'a revoked link offers nothing'
);
select is(
  (select count(*)::int from public.trial_pass_offer('NOSUCHTK')),
  0,
  'an unknown token offers nothing'
);

-- 13. Grants: the public half is anon, the writing half is not.
select ok(
  has_function_privilege('anon', 'public.trial_pass_offer(text)', 'execute'),
  'anon can read a trial offer'
);
select ok(
  not has_function_privilege('anon', 'public.redeem_trial_pass(text,uuid)', 'execute'),
  'anon cannot redeem a trial pass'
);

-- 14. RLS: the passes are staff-only, under the capability that governs
--     comps — a plain member sees none.
select _test_act_as(current_setting('test.member')::uuid);
select is(
  (select count(*)::int from public.trial_passes),
  0,
  'a member cannot read the gym''s trial links'
);

-- 15. Asking twice for the same prospect's link returns the same link
--     rather than an error about a unique index.
select _test_act_as(current_setting('test.coach')::uuid);
do $$
declare v_a text; v_b text; v_lead uuid;
begin
  insert into public.leads (gym_id, full_name, email, status, lawful_basis)
  values (current_setting('test.gym')::uuid, 'Sam Prospect',
          'sam@prospect.test', 'cold'::public.lead_status, 'legitimate_interest')
  returning id into v_lead;
  select t.token into v_a
    from public.create_trial_pass(
      current_setting('test.gym')::uuid,
      current_setting('test.ct')::uuid,
      null, 1, 14, null, null, v_lead) t;
  select t.token into v_b
    from public.create_trial_pass(
      current_setting('test.gym')::uuid,
      current_setting('test.ct')::uuid,
      null, 1, 14, null, null, v_lead) t;
  perform set_config('test.tok_a', v_a, false);
  perform set_config('test.tok_b', v_b, false);
end $$;
select is(
  current_setting('test.tok_b'),
  current_setting('test.tok_a'),
  'minting a personal link twice returns the live one'
);

select * from finish();
rollback;
