-- The roster can change (0223)
--
-- Two writes that never existed, and one raw-role helper that outlived
-- the person it was reading. Everything here is about the ladder: who is
-- allowed to change whom, and what a gym must never be left without.

begin;
select plan(17);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@roster.test');
  v_owner2 uuid := _test_mk_user('owner2@roster.test');
  v_admin  uuid := _test_mk_user('admin@roster.test');
  v_coach  uuid := _test_mk_user('coach@roster.test');
  v_member uuid := _test_mk_user('member@roster.test');
  v_gone   uuid := _test_mk_user('gone@roster.test');
  v_gym    uuid := _test_mk_gym('Roster Gym', 'roster-gym');
  v_solo   uuid := _test_mk_user('solo@roster.test');
  v_solog  uuid := _test_mk_gym('Solo Gym', 'solo-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_owner2, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- An admin who left in March. The bug: user_can_admin still said yes.
  perform _test_mk_membership(v_gym, v_gone, 'admin');
  update public.gym_memberships set left_at = now() - interval '4 months'
    where gym_id = v_gym and profile_id = v_gone;

  perform _test_mk_membership(v_solog, v_solo, 'owner');

  -- Granted to the coach for the job they have. A demotion must not
  -- carry it into the next one.
  insert into public.gym_member_capabilities
    (gym_id, profile_id, capability, enabled)
  values (v_gym, v_coach, 'can_see_money', true);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.owner2', v_owner2::text, true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.gone',   v_gone::text,   true);
  perform set_config('test.solo',   v_solo::text,   true);
  perform set_config('test.solog',  v_solog::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- A departed admin is not an admin
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.gone')::uuid);

select ok(
  not public.user_can_admin(current_setting('test.gym')::uuid),
  'somebody who left four months ago no longer counts as an admin'
);

select throws_ok(
  format(
    'select public.leave_gym(%L::uuid, %L::uuid)',
    current_setting('test.gym'), current_setting('test.member')
  ),
  null, 'Not authorised',
  'and cannot remove anyone'
);

-- ---------------------------------------------------------------------------
-- The role change: who may, and who may not
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''coach'')',
    current_setting('test.gym'), current_setting('test.member')
  ),
  'an owner can make a member a coach'
);

select is(
  (select role::text from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.member')::uuid),
  'coach',
  'and the row says so'
);

select lives_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''member'')',
    current_setting('test.gym'), current_setting('test.member')
  ),
  'and back again — a demotion is not a removal'
);

select is(
  (select left_at from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.member')::uuid),
  null,
  'the membership survives the demotion'
);

-- can_manage_staff defaults to admin, so this is the widened-gate case.
select _test_act_as(current_setting('test.admin')::uuid);

select lives_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''staff'')',
    current_setting('test.gym'), current_setting('test.member')
  ),
  'an admin can move somebody between the ordinary roles'
);

select throws_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''admin'')',
    current_setting('test.gym'), current_setting('test.member')
  ),
  null, 'Only owners can make someone an owner or an admin',
  'but cannot mint another admin'
);

select throws_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''coach'')',
    current_setting('test.gym'), current_setting('test.owner')
  ),
  null, 'Only owners can change an owner or an admin',
  'and cannot demote the owner who granted them the switch'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''coach'')',
    current_setting('test.gym'), current_setting('test.member')
  ),
  null, 'Not authorised',
  'a coach without can_manage_staff cannot change anyone'
);

-- ---------------------------------------------------------------------------
-- The gym keeps an owner
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.solo')::uuid);

select throws_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''coach'')',
    current_setting('test.solog'), current_setting('test.solo')
  ),
  null, 'A gym needs an owner — make someone else an owner first',
  'the only owner cannot demote themselves'
);

select throws_ok(
  format(
    'select public.leave_gym(%L::uuid, %L::uuid)',
    current_setting('test.solog'), current_setting('test.solo')
  ),
  null, 'A gym needs an owner — make someone else an owner first',
  'nor walk out'
);

-- Two owners, so either may go.
select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  format(
    'select public.leave_gym(%L::uuid, %L::uuid)',
    current_setting('test.gym'), current_setting('test.owner')
  ),
  'an owner with a co-owner can leave'
);

-- ---------------------------------------------------------------------------
-- Removal follows the same ladder
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.admin')::uuid);

-- The co-owner, who is still here — test.owner walked out one test ago,
-- and removing somebody already gone is a no-op rather than a refusal.
select throws_ok(
  format(
    'select public.leave_gym(%L::uuid, %L::uuid)',
    current_setting('test.gym'), current_setting('test.owner2')
  ),
  null, 'Only owners can remove owners or admins',
  'an admin cannot remove an owner'
);

select lives_ok(
  format(
    'select public.leave_gym(%L::uuid, %L::uuid)',
    current_setting('test.gym'), current_setting('test.member')
  ),
  'but can remove an ordinary member'
);

select _test_act_as(current_setting('test.owner2')::uuid);

select lives_ok(
  format(
    'select public.set_member_role(%L::uuid, %L::uuid, ''staff'')',
    current_setting('test.gym'), current_setting('test.coach')
  ),
  'a coach can be moved to the front desk'
);

select is(
  (select count(*)::int from public.gym_member_capabilities
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.coach')::uuid),
  0,
  'and the per-person switch granted for the old job goes with it'
);

select * from finish();
rollback;
