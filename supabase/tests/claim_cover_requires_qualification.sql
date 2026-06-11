-- Invariant: claim_cover refuses a coach with an explicit
-- disqualification for the session's class type, but lets a qualified
-- coach claim the same offer.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@qual.test');
  v_coach_a uuid := _test_mk_user('coach_a@qual.test');  -- original coach
  v_coach_b uuid := _test_mk_user('coach_b@qual.test');  -- disqualified
  v_coach_c uuid := _test_mk_user('coach_c@qual.test');  -- qualified
  v_gym     uuid := _test_mk_gym('Qual Gym', 'qual');
  v_ct      uuid;
  v_session uuid;
  v_request uuid;
  v_offer   uuid;
  v_at      timestamptz := now() + interval '2 days';
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');
  perform _test_mk_membership(v_gym, v_coach_c, 'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit Kids', '#F97316')
    returning id into v_ct;

  -- Coach A's class (on that class type) needs cover.
  v_session := _test_mk_session(v_gym, v_coach_a, v_at, 60, v_ct);

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach_a, v_at, v_at + interval '1 hour')
  returning id into v_request;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request, v_session, v_coach_a, v_gym)
  returning id into v_offer;

  -- Coach B is explicitly disqualified for this class type.
  insert into public.coach_class_type_qualifications
    (gym_id, profile_id, class_type_id, qualified, updated_by)
  values
    (v_gym, v_coach_b, v_ct, false, v_owner);

  perform set_config('test.offer',   v_offer::text,   true);
  perform set_config('test.session', v_session::text, true);
  perform set_config('test.coach_a', v_coach_a::text, true);
  perform set_config('test.coach_c', v_coach_c::text, true);
  perform set_config('test.coach_b', v_coach_b::text, true);
end;
$$;

-- 1. Disqualified coach B's claim raises.
do $$ begin perform _test_act_as(current_setting('test.coach_b')::uuid); end $$;

select throws_like(
  format('select claim_cover(%L::uuid)', current_setting('test.offer')),
  '%not qualified%',
  'claim_cover refuses a coach disqualified for the class type'
);

-- 2. Session still coached by A after the failed claim.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;

select is(
  (select coach_id::text from public.class_sessions
     where id = current_setting('test.session')::uuid),
  current_setting('test.coach_a'),
  'session keeps its original coach after a blocked claim'
);

-- 3. Qualified coach C (no disqualification row) can claim it.
do $$ begin perform _test_act_as(current_setting('test.coach_c')::uuid); end $$;

select lives_ok(
  format('select claim_cover(%L::uuid)', current_setting('test.offer')),
  'a qualified coach can claim the same offer'
);

select * from finish();
rollback;
