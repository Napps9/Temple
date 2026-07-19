-- agent_interviews (0147): interview-mode rows are owner-visible only, and
-- the only client write is the applied/discarded verdict through
-- set_agent_interview_status.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@interview.test');
  v_coach uuid := _test_mk_user('coach@interview.test');
  v_owner_b uuid := _test_mk_user('owner-b@interview.test');
  v_gym   uuid := _test_mk_gym('Interview Gym', 'interview-gym');
  v_gym_b uuid := _test_mk_gym('Other Interview Gym', 'interview-gym-b');
  v_row   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');
  insert into public.agent_interviews (gym_id, phone, status, transcript, draft_brief)
  values (v_gym, '+447700900950', 'completed', 'Owner: first class is free.',
          'You are the front desk…')
  returning id into v_row;
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.row',    v_row::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.owner_b', v_owner_b::text, true);
end $$;

-- 1. The gym's owner can read their interview.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_interviews
   where id = current_setting('test.row')::uuid),
  1,
  'the owner sees their interview'
);

-- 2. Marking it applied works for the owner.
do $$ begin
  perform public.set_agent_interview_status(current_setting('test.row')::uuid, 'applied');
end $$;
select is(
  (select status from public.agent_interviews
   where id = current_setting('test.row')::uuid),
  'applied',
  'the owner can mark an interview applied'
);

-- 3. Arbitrary statuses are rejected even for the owner.
select throws_like(
  format($$ select public.set_agent_interview_status(%L::uuid, 'calling') $$,
         current_setting('test.row')),
  '%applied or discarded%',
  'only the applied/discarded verdicts are writable'
);

-- 4. A coach cannot see the interview.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_interviews
   where id = current_setting('test.row')::uuid),
  0,
  'a coach sees no interviews'
);

-- 5. Nor can they write a verdict.
select throws_like(
  format($$ select public.set_agent_interview_status(%L::uuid, 'discarded') $$,
         current_setting('test.row')),
  '%owner%',
  'a coach cannot review an interview'
);

-- 6. Another gym's owner sees nothing.
do $$ begin perform _test_act_as(current_setting('test.owner_b')::uuid); end $$;
select is(
  (select count(*)::int from public.agent_interviews
   where gym_id = current_setting('test.gym')::uuid),
  0,
  'another gym''s owner sees nothing'
);

select * from finish();
rollback;
