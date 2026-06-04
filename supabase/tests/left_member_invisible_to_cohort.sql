-- Setting gym_memberships.left_at drops the member from v_member_cohort
-- (so insights, exports, and the members list stop counting them) but
-- preserves their class_bookings rows so history still renders.

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@leftcohort.test');
  v_gym   uuid := _test_mk_gym('Left Cohort', 'leftcohort');
  v_member uuid := _test_mk_user('m@leftcohort.test');
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  v_sess := _test_mk_session(v_gym, v_owner, now() - interval '1 day');
  perform _test_mk_booking(v_sess, v_member);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);

  perform _test_act_as(v_owner);

  -- Sanity: member shows up in cohort before left_at is set.
end;
$$;

select is(
  (select count(*)::int from public.v_member_cohort
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid),
  1,
  'before left_at: member visible in v_member_cohort'
);

do $$
begin
  update public.gym_memberships
    set left_at = now()
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid;
end;
$$;

select is(
  (select count(*)::int from public.v_member_cohort
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid),
  0,
  'after left_at: member filtered out of v_member_cohort'
);

select is(
  (select count(*)::int from public.class_bookings
    where profile_id = current_setting('test.member')::uuid),
  1,
  'past booking still selectable by staff'
);

select * from finish();
rollback;
