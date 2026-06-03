-- Invariant: admins cannot claim cover offers.
--
-- can_claim_cover is false for admin in the capability matrix.
-- claim_cover gates on user_can_cover (owner/coach only). If the
-- gate were user_can_manage_classes (which now includes admin), an
-- admin could claim a coach's class — the bug the plan called out.

begin;
select plan(1);

\i tests/_helpers.sql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@cover.test');
  v_coach   uuid := _test_mk_user('coach@cover.test');
  v_admin   uuid := _test_mk_user('admin@cover.test');
  v_gym     uuid := _test_mk_gym('Cover Gym', 'cover');
  v_session uuid;
  v_request uuid;
  v_offer   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_admin, 'admin');

  v_session := _test_mk_session(v_gym, v_coach, now() + interval '1 day');

  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach, now() + interval '1 day', now() + interval '1 day 1 hour')
  returning id into v_request;

  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values
    (v_request, v_session, v_coach, v_gym)
  returning id into v_offer;

  perform set_config('test.offer', v_offer::text, true);

  -- Act as admin for the upcoming throws_ok.
  perform _test_act_as(v_admin);
end;
$$;

select throws_ok(
  format('select claim_cover(%L::uuid)', current_setting('test.offer')),
  null::text,
  null::text,
  'admin attempting claim_cover raises'
);

select * from finish();
rollback;
