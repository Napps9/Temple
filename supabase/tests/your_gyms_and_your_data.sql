-- my_gyms + export_my_account_data (0255): the Account page's two
-- self-only functions. my_gyms resolves a LEFT gym's name (the plain
-- gyms select refuses it since 0237) and returns only the caller's
-- rows. The export carries the member's bookings, both directions of
-- their messages and their PAR-Q answers with prompts — and never a
-- third party's thread. anon can execute neither.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_member  uuid := _test_mk_user('member@yourdata.test');
  v_coach   uuid := _test_mk_user('coach@yourdata.test');
  v_other   uuid := _test_mk_user('other@yourdata.test');
  v_gym     uuid := _test_mk_gym('Home Gym', 'yourdata-home');
  v_old     uuid := _test_mk_gym('Old Gym', 'yourdata-old');
  v_sess    uuid;
  v_qnr     uuid;
  v_q       uuid;
begin
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other, 'member');
  perform _test_mk_membership(v_old, v_member, 'member');

  v_sess := _test_mk_session(v_gym, v_coach, now() + interval '1 day');
  perform _test_mk_booking(v_sess, v_member);

  -- A PAR-Q with one question, answered by the member below.
  insert into public.parq_questionnaires (gym_id, version, is_active, published_by)
  values (v_gym, 1, true, v_coach)
  returning id into v_qnr;
  insert into public.parq_questions (questionnaire_id, sort_order, prompt, flag_on_yes)
  values (v_qnr, 1, 'Has your doctor ever said you have a heart condition?', true)
  returning id into v_q;

  perform set_config('test.member', v_member::text, false);
  perform set_config('test.coach',  v_coach::text,  false);
  perform set_config('test.other',  v_other::text,  false);
  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.old',    v_old::text,    false);
  perform set_config('test.qnr',    v_qnr::text,    false);
  perform set_config('test.q',      v_q::text,      false);
end $$;

-- Fixture writes that must go through RLS as the people themselves:
-- the member answers the PAR-Q and messages the coach, the coach
-- replies, the two OTHER people exchange their own thread, and the
-- member leaves the old gym through the real path.
select _test_act_as(current_setting('test.member')::uuid);
select lives_ok(
  $$select public.submit_parq_response(
      current_setting('test.gym')::uuid,
      current_setting('test.qnr')::uuid,
      jsonb_build_array(jsonb_build_object(
        'question_id', current_setting('test.q')::uuid,
        'answered_yes', true,
        'explanation', 'Murmur as a child.')))$$,
  'the member submits their PAR-Q through the real path'
);
insert into public.direct_messages (gym_id, sender_id, recipient_id, body)
values (current_setting('test.gym')::uuid,
        current_setting('test.member')::uuid,
        current_setting('test.coach')::uuid,
        'Sent by me');
select lives_ok(
  $$select public.leave_gym(current_setting('test.old')::uuid,
                            current_setting('test.member')::uuid)$$,
  'the member leaves the old gym through the real path'
);
select _test_act_as(current_setting('test.coach')::uuid);
insert into public.direct_messages (gym_id, sender_id, recipient_id, body)
values (current_setting('test.gym')::uuid,
        current_setting('test.coach')::uuid,
        current_setting('test.member')::uuid,
        'Received by me');
select _test_act_as(current_setting('test.other')::uuid);
insert into public.direct_messages (gym_id, sender_id, recipient_id, body)
values (current_setting('test.gym')::uuid,
        current_setting('test.other')::uuid,
        current_setting('test.coach')::uuid,
        'Nothing to do with the member');

-- 1. my_gyms returns both memberships WITH names, the left one included.
select _test_act_as(current_setting('test.member')::uuid);
select results_eq(
  $$select gym_name, (left_at is not null) as has_left
      from public.my_gyms() order by gym_name$$,
  $$select * from (values ('Home Gym'::text, false), ('Old Gym'::text, true))
      as t(gym_name, has_left)$$,
  'my_gyms names both gyms, the left one included'
);

-- 2. The plain gyms select refuses the left gym — the reason the
--    definer function exists.
select results_eq(
  $$select count(*)::integer as n from public.gyms
     where id = current_setting('test.old')::uuid$$,
  $$select 0::integer as n$$,
  'the left gym is invisible to a plain gyms select'
);

-- 3. Another member sees only their own membership, never the caller's.
select _test_act_as(current_setting('test.other')::uuid);
select results_eq(
  $$select count(*)::integer as n from public.my_gyms()$$,
  $$select 1::integer as n$$,
  'my_gyms returns only the caller''s rows'
);

-- 4-7. The export, as the member.
select _test_act_as(current_setting('test.member')::uuid);
select ok(
  jsonb_array_length(public.export_my_account_data()->'bookings') = 1,
  'the export carries the member''s booking'
);
select results_eq(
  $$select jsonb_agg(m->>'body' order by m->>'body') as bodies
      from jsonb_array_elements(public.export_my_account_data()->'messages') m$$,
  $$select jsonb_build_array('Received by me', 'Sent by me') as bodies$$,
  'messages carry both directions and never a third party''s thread'
);
select ok(
  (public.export_my_account_data()
     ->'health'->'parq_responses'->0->'answers'->0->>'question')
    = 'Has your doctor ever said you have a heart condition?',
  'PAR-Q answers travel with their question prompts'
);
select ok(
  (public.export_my_account_data()->'training') ? 'workouts',
  'the training export is nested inside'
);

-- 8-9. anon holds no grant on either function.
select ok(
  not has_function_privilege('anon', 'public.my_gyms()', 'execute'),
  'anon cannot execute my_gyms'
);
select ok(
  not has_function_privilege('anon', 'public.export_my_account_data()', 'execute'),
  'anon cannot execute export_my_account_data'
);

select * from finish();
rollback;
