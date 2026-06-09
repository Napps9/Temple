-- RLS + flag-raising end-to-end on PAR-Q submissions:
--   - Owner publishes a questionnaire with one flagged question.
--   - Member A submits with "yes" on the flagged question -> has_flag
--     is true, a staff_alert is created, gym_memberships.health_flag
--     is updated.
--   - Member B can NOT SELECT A's response (RLS isolation).
--   - The owner CAN SELECT A's response (can_see_health_flag).
--   - The owner can SELECT the open staff_alert; member A cannot.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@parq.test');
  v_a     uuid := _test_mk_user('a@parq.test');
  v_b     uuid := _test_mk_user('b@parq.test');
  v_gym   uuid := _test_mk_gym('PARQ Gym', 'parq-gym');
  v_qaire uuid;
  v_q1    uuid;
  v_q2    uuid;
  v_resp  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (v_gym, 1, v_owner)
    returning id into v_qaire;

  insert into public.parq_questions (questionnaire_id, sort_order, prompt, flag_on_yes)
    values
      (v_qaire, 1, 'Do you have a heart condition?', true)
    returning id into v_q1;

  insert into public.parq_questions (questionnaire_id, sort_order, prompt, flag_on_yes)
    values
      (v_qaire, 2, 'Any goals?', false)
    returning id into v_q2;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.qaire', v_qaire::text, true);
  perform set_config('test.q1',    v_q1::text,    true);
  perform set_config('test.q2',    v_q2::text,    true);
end;
$$;

-- Member A submits "yes" to the flagged question.
do $$
declare
  v_resp uuid;
begin
  perform _test_act_as(current_setting('test.a')::uuid);
  select public.submit_parq_response(
    current_setting('test.gym')::uuid,
    current_setting('test.qaire')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'question_id', current_setting('test.q1')::uuid,
        'answered_yes', true,
        'explanation', 'Mild murmur, cleared by GP'
      ),
      jsonb_build_object(
        'question_id', current_setting('test.q2')::uuid,
        'answered_yes', false
      )
    )
  ) into v_resp;
  perform set_config('test.resp', v_resp::text, true);
end;
$$;

-- A can read their own response and it carries the flag.
select is(
  (select has_flag from public.parq_responses
    where id = current_setting('test.resp')::uuid),
  true,
  'A''s own submission has has_flag = true'
);

-- gym_memberships.health_flag mirrors the flag.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end; $$;
select is(
  (select health_flag from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.a')::uuid),
  true,
  'gym_memberships.health_flag mirrors the PAR-Q flag'
);

-- Owner can SELECT A's response (can_see_health_flag).
select is(
  (select count(*) from public.parq_responses
    where profile_id = current_setting('test.a')::uuid)::int,
  1,
  'owner can SELECT A''s PAR-Q response'
);

-- Owner sees the open staff_alert.
select is(
  (select count(*) from public.staff_alerts
    where gym_id = current_setting('test.gym')::uuid
      and subject_profile_id = current_setting('test.a')::uuid
      and kind = 'parq_flag'
      and acknowledged_at is null)::int,
  1,
  'owner sees one open parq_flag staff_alert for A'
);

-- Member B cannot SELECT A's response.
do $$ begin perform _test_act_as(current_setting('test.b')::uuid); end; $$;
select is(
  (select count(*) from public.parq_responses
    where profile_id = current_setting('test.a')::uuid)::int,
  0,
  'member B cannot SELECT A''s PAR-Q response'
);

select * from finish();
rollback;
