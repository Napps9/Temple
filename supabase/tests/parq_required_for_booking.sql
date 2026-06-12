-- PAR-Q is a booking prerequisite: no questionnaire = bootstrap pass
-- (so an owner can publish one in the first place), but once one is
-- published, no booking without a current response.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@parqbook.test');
  v_member  uuid := _test_mk_user('m@parqbook.test');
  v_gym     uuid := _test_mk_gym('Parq Book Gym', 'parq-book');
  v_plan    uuid;
  v_sess    uuid;
  v_q       uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Unlimited plan so the eligibility check doesn't bounce the member
  -- ahead of the PAR-Q gate.
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlim', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select id, v_member, v_gym, v_plan, 'active'::public.plan_sub_state
    from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sess',   v_sess::text,   true);
end $$;

-- 1. No questionnaire published yet → booking succeeds (bootstrap).
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.sess')),
  'book_class succeeds when the gym has no active PAR-Q questionnaire'
);

-- 2. Owner publishes a questionnaire; member tries to book a different
--    session → blocked with the PAR-Q hint.
do $$
declare
  v_q     uuid;
  v_sess2 uuid;
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (current_setting('test.gym')::uuid, 1,
            current_setting('test.owner')::uuid)
    returning id into v_q;
  v_sess2 := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '3 days');
  perform set_config('test.q',     v_q::text,     true);
  perform set_config('test.sess2', v_sess2::text, true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.sess2')),
  '%PAR-Q required%',
  'book_class refuses when the booker has not completed the active PAR-Q'
);

-- 3. Member submits a current PAR-Q response → booking succeeds.
do $$
begin
  insert into public.parq_responses
    (gym_id, profile_id, questionnaire_id, has_flag)
  values
    (current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid,
     current_setting('test.q')::uuid,
     false);
end $$;

select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.sess2')),
  'book_class succeeds after the booker completes the active PAR-Q'
);

-- 4. A stale response (>365 days old) does not satisfy the gate.
do $$
declare
  v_sess3 uuid;
begin
  -- Fixture mutation: parq_responses has no UPDATE RLS policy
  -- (responses are immutable from the API), so we drop to the test
  -- DB role to age the row directly. Same trick the helpers use to
  -- set up state RLS would otherwise block.
  reset role;
  update public.parq_responses
    set completed_at = now() - interval '400 days'
    where profile_id = current_setting('test.member')::uuid;
  perform _test_act_as(current_setting('test.owner')::uuid);
  -- Cancel the just-made booking so capacity isn't an issue and we
  -- isolate the staleness check.
  delete from public.class_bookings
    where class_session_id = current_setting('test.sess2')::uuid
      and profile_id = current_setting('test.member')::uuid;
  v_sess3 := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '4 days');
  perform set_config('test.sess3', v_sess3::text, true);
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.sess3')),
  '%PAR-Q required%',
  'book_class refuses when the latest PAR-Q response is older than 365 days'
);

select * from finish();
rollback;
