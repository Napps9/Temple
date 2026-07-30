-- "Send invites" now sends invites (0218).
--
-- This is the one capability change that widens access rather than
-- tightening it, so the assertions that matter most are the ones proving
-- what did NOT widen. A coach granted "Send invites" can bring in a
-- member, a coach and front desk — and still cannot mint an admin or an
-- owner, which is the only thing between this change and a coach
-- promoting themselves.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@invitecap.test');
  v_admin uuid := _test_mk_user('admin@invitecap.test');
  v_coach uuid := _test_mk_user('coach@invitecap.test');
  v_gym   uuid := _test_mk_gym('Invite Gym', 'invitecap');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- ============================================================================
-- Nothing changes for a gym that has overridden nothing
-- ============================================================================

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'coach'::public.gym_role, null) $$,
  'Not authorised',
  'a coach with nothing granted still cannot invite anyone'
);

select _test_act_as(current_setting('test.admin')::uuid);

select lives_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'coach'::public.gym_role, null) $$,
  'an admin still invites a coach, because can_invite defaults to their role too'
);

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'admin'::public.gym_role, null) $$,
  'and the owner still mints an admin'
);

-- ============================================================================
-- The switch now does what it says
-- ============================================================================

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'coach', 'can_invite', true);

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'member'::public.gym_role, null) $$,
  'the same coach, granted "Send invites", can bring in a member'
);

select lives_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'coach'::public.gym_role, null) $$,
  'and another coach — the label says members and staff'
);

select lives_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'staff'::public.gym_role, null) $$,
  'and front desk'
);

-- ============================================================================
-- What did not widen
-- ============================================================================
--
-- The ladder is the only thing between this change and a coach promoting
-- themselves, so both halves of it get an assertion.

select throws_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'admin'::public.gym_role, null) $$,
  'Only owners can invite owners or admins',
  'but not an admin, however much they were granted'
);

select throws_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'owner'::public.gym_role, null) $$,
  'Only owners can invite owners or admins',
  'and not an owner'
);

-- Granting can_manage_staff as well must not open the ladder either: it
-- is structural, not a capability anybody can be given.
select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'coach', 'can_manage_staff', true);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'admin'::public.gym_role, null) $$,
  'Only owners can invite owners or admins',
  'nor with every staff capability an owner could hand them'
);

-- And turning the switch back off closes it again.
select _test_act_as(current_setting('test.owner')::uuid);

update public.gym_role_capabilities set enabled = false
  where gym_id = current_setting('test.gym')::uuid
    and role = 'coach' and capability = 'can_invite';

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.create_invite(
       current_setting('test.gym')::uuid, 'member'::public.gym_role, null) $$,
  'Not authorised',
  'and switching it back off takes it away again'
);

select finish();
rollback;
