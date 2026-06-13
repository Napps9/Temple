-- parq_expiry_days is now per-gym. A gym that lowers it to 180 (six
-- months) must reject a response that was fine under the 365-day
-- default. The 365-day path is already covered by
-- parq_required_for_booking.sql; this file pins the configurability.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@parqexp.test');
  v_member uuid := _test_mk_user('m@parqexp.test');
  v_gym    uuid := _test_mk_gym('Parq Expiry Gym', 'parq-expiry-gym');
  v_plan   uuid;
  v_q      uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlim', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select id, v_member, v_gym, v_plan, 'active'::public.plan_sub_state
    from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (v_gym, 1, v_owner) returning id into v_q;

  -- Tighten the gym's parq expiry to 180 days.
  update public.gyms set parq_expiry_days = 180 where id = v_gym;

  -- Member submitted a response 200 days ago — fine at 365, stale at 180.
  insert into public.parq_responses
    (gym_id, profile_id, questionnaire_id, has_flag)
  values (v_gym, v_member, v_q, false);

  reset role;
  update public.parq_responses
    set completed_at = now() - interval '200 days'
    where profile_id = v_member;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sess',   v_sess::text,   true);
end $$;

-- 1. Booking is refused under the tightened window.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.sess')),
  '%PAR-Q required%',
  '180-day expiry rejects a 200-day-old response that 365 would accept'
);

-- 2. current_parq_state agrees: needs_parq is true.
select is(
  (select needs_parq from public.current_parq_state(
     current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid)),
  true,
  'current_parq_state reports needs_parq under the tightened window'
);

-- 3. Relax to 400 days and the same response passes.
do $$ begin reset role; end $$;
update public.gyms set parq_expiry_days = 400
  where id = current_setting('test.gym')::uuid;
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.sess')),
  'widening parq_expiry_days to 400 makes the 200-day-old response valid again'
);

select * from finish();
rollback;
