-- Retention cockpit (0116): can_see_retention capability defaults, and
-- that effective_can honours the owner bypass, the role defaults, and an
-- explicit per-gym override.
--
-- Fixture writes (gyms, memberships, the override row) all happen in the
-- setup block before any _test_act_as switch, since RESET ROLE doesn't
-- reliably undo the switch within one transaction (see _helpers.psql).

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@ret.test');
  v_admin uuid := _test_mk_user('admin@ret.test');
  v_coach uuid := _test_mk_user('coach@ret.test');
  v_staff uuid := _test_mk_user('staff@ret.test');
  v_gym   uuid := _test_mk_gym('Ret Gym', 'ret-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_staff, 'staff');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.staff', v_staff::text, true);
end $$;

-- 1-4. Capability defaults: admin + coach in; staff + member out.
select is(public.default_capability('admin', 'can_see_retention'), true,
  'admin sees retention by default');
select is(public.default_capability('coach', 'can_see_retention'), true,
  'coach sees retention by default');
select is(public.default_capability('staff', 'can_see_retention'), false,
  'front-desk staff do not see retention by default');
select is(public.default_capability('member', 'can_see_retention'), false,
  'a member never sees retention');

-- 5. effective_can: an admin resolves true through the default.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_retention'),
  true,
  'an admin effectively can see retention');

-- 6. effective_can: a coach resolves true through the default.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_retention'),
  true,
  'a coach effectively can see retention');

-- 7. effective_can: front-desk staff resolves false.
do $$ begin perform _test_act_as(current_setting('test.staff')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_retention'),
  false,
  'front-desk staff effectively cannot see retention');

-- 8. An explicit override can revoke it from a coach. The write goes
-- through the owner, whose RLS policy permits it (a coach/staff can't
-- write the capability table).
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$
begin
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'coach', 'can_see_retention', false);
end $$;
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_retention'),
  false,
  'a per-gym override revokes retention from a coach');

-- 9. The owner bypasses every check regardless of overrides.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_retention'),
  true,
  'the owner always sees retention');

select * from finish();
rollback;
