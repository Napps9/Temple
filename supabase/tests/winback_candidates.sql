-- Retention cockpit (0120): v_winback_candidates is the standing reactivation
-- segment v_member_cohort can't express — lapsed members (left_at set) and
-- never-activated imports (pending_members still pending/invited). Current
-- members and already-linked imports must not appear.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@wb.test');
  v_lapsed  uuid := _test_mk_user('lapsed@wb.test');
  v_active  uuid := _test_mk_user('active@wb.test');
  v_gym     uuid := _test_mk_gym('WB Gym', 'wb-gym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_lapsed, 'member');
  perform _test_mk_membership(v_gym, v_active, 'member');

  -- The lapsed member left the gym.
  update public.gym_memberships
    set left_at = now() - interval '40 days'
    where gym_id = v_gym and profile_id = v_lapsed;

  -- A never-activated import (still pending) and an already-linked one.
  insert into public.pending_members (gym_id, email, full_name, status)
  values (v_gym, 'prospect@wb.test', 'Pat Prospect', 'pending');
  insert into public.pending_members (gym_id, email, full_name, status)
  values (v_gym, 'joined@wb.test', 'Jo Joined', 'linked');

  perform _test_act_as(v_owner);
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.lapsed', v_lapsed::text, true);
  perform set_config('test.active', v_active::text, true);
end $$;

-- 1. The lapsed member appears, tagged 'lapsed', with their leave date.
select is(
  (select kind from public.v_winback_candidates
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.lapsed')::uuid),
  'lapsed',
  'a member who left is a lapsed win-back candidate');
select ok(
  (select last_seen_at is not null from public.v_winback_candidates
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.lapsed')::uuid),
  'the lapsed candidate carries a last-seen (leave) date');

-- 2. The pending import appears as never_activated.
select is(
  (select count(*)::int from public.v_winback_candidates
   where gym_id = current_setting('test.gym')::uuid
     and kind = 'never_activated'
     and full_name = 'Pat Prospect'),
  1,
  'a still-pending import is a never_activated candidate');

-- 3. A linked import is not a win-back candidate.
select is(
  (select count(*)::int from public.v_winback_candidates
   where gym_id = current_setting('test.gym')::uuid
     and full_name = 'Jo Joined'),
  0,
  'an already-linked import is not a win-back candidate');

-- 4. A current member is not a win-back candidate.
select is(
  (select count(*)::int from public.v_winback_candidates
   where gym_id = current_setting('test.gym')::uuid
     and member_id = current_setting('test.active')::uuid),
  0,
  'a current member is not a win-back candidate');

select * from finish();
rollback;
