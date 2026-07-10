-- Retention cockpit (0121): assign_member_coach sets a member's owning coach,
-- guards both sides against cross-tenant IDs, clears on a null coach, and is
-- gated on can_see_retention. The table has no client write path.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner       uuid := _test_mk_user('owner@mca.test');
  v_coach       uuid := _test_mk_user('coach@mca.test');
  v_coach2      uuid := _test_mk_user('coach2@mca.test');
  v_member      uuid := _test_mk_user('member@mca.test');
  v_stranger    uuid := _test_mk_user('stranger@mca.test');
  v_gym         uuid := _test_mk_gym('MCA Gym', 'mca-gym');
  v_other_coach uuid := _test_mk_user('coach@other-mca.test');
  v_other_gym   uuid := _test_mk_gym('Other MCA', 'other-mca');
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach,   'coach');
  perform _test_mk_membership(v_gym, v_coach2,  'coach');
  perform _test_mk_membership(v_gym, v_member,  'member');
  perform _test_mk_membership(v_other_gym, v_other_coach, 'coach');

  perform _test_act_as(v_owner);
  perform set_config('test.gym',       v_gym::text,       true);
  perform set_config('test.coach',     v_coach::text,     true);
  perform set_config('test.coach2',    v_coach2::text,    true);
  perform set_config('test.member',    v_member::text,    true);
  perform set_config('test.stranger',  v_stranger::text,  true);
  perform set_config('test.other_coach', v_other_coach::text, true);
end $$;

-- 1. Happy path: assign a coach.
select lives_ok(
  $$ select public.assign_member_coach(
       current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid,
       current_setting('test.coach')::uuid) $$,
  'owner can assign a coach to a member');
select is(
  (select coach_id from public.member_coach_assignments
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.member')::uuid),
  current_setting('test.coach')::uuid,
  'the assignment records the chosen coach');

-- 2. Reassign updates in place.
select lives_ok(
  $$ select public.assign_member_coach(
       current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid,
       current_setting('test.coach2')::uuid) $$,
  'reassigning to another coach is allowed');
select is(
  (select coach_id from public.member_coach_assignments
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.member')::uuid),
  current_setting('test.coach2')::uuid,
  'reassignment updates the coach in place');

-- 3. A coach from another gym is refused.
select throws_ok(
  $$ select public.assign_member_coach(
       current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid,
       current_setting('test.other_coach')::uuid) $$,
  'Coach is not a staff member of this gym',
  'a cross-tenant coach cannot be assigned');

-- 4. A non-member target is refused.
select throws_ok(
  $$ select public.assign_member_coach(
       current_setting('test.gym')::uuid,
       current_setting('test.stranger')::uuid,
       current_setting('test.coach')::uuid) $$,
  'Member is not part of this gym',
  'a non-member cannot be assigned a coach');

-- 5. A null coach clears the assignment.
do $$
begin
  perform public.assign_member_coach(
    current_setting('test.gym')::uuid,
    current_setting('test.member')::uuid,
    null);
end $$;
select is(
  (select count(*)::int from public.member_coach_assignments
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.member')::uuid),
  0,
  'assigning a null coach clears the assignment');

select * from finish();
rollback;
