-- A button you are shown and then refused (0245).
--
-- Six lifecycle RPCs from 0017 authorised with role predicates that
-- predate the capability matrix, and the buttons in front of them are
-- gated on capabilities. The two halves disagreed in both directions, so
-- both directions are asserted here:
--
--   granting can_archive_plans to an admin used to change nothing — the
--   Archive button appeared and archive_plan raised 'Not authorised'
--
--   revoking can_archive_classes from a coach used to change nothing
--   either — the button vanished and the RPC still said yes
--
-- The first two assertions exist to prove a gym that has overridden
-- nothing sees no change at all, which is the whole safety argument for
-- swapping the predicate under six live functions.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@archcap.test');
  v_admin uuid := _test_mk_user('admin@archcap.test');
  v_coach uuid := _test_mk_user('coach@archcap.test');
  v_gone  uuid := _test_mk_user('gone@archcap.test');
  v_gym   uuid := _test_mk_gym('Archive Gym', 'archcap');
  v_plan  uuid;
  v_spare uuid;
  v_held  uuid;
  v_type  uuid;
  v_mem   uuid;
  v_mship uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_gone,  'admin');

  -- Left the gym, membership row still there. user_is_owner_of and
  -- user_can_admin_or_coach both read role and nothing else.
  update public.gym_memberships set left_at = now()
    where gym_id = v_gym and profile_id = v_gone;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Off-peak', 'unlimited', 5900) returning plan_id into v_spare;

  -- A plan somebody is on, to prove the dependent check survived the
  -- rewrite rather than being lost with the predicate it sat next to.
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Student', 'unlimited', 3900) returning plan_id into v_held;
  v_mem := _test_mk_user('student@archcap.test');
  v_mship := _test_mk_membership(v_gym, v_mem, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mship, v_mem, v_gym, v_held, 'active');

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'CrossFit', '#2563EB') returning id into v_type;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.plan',  v_plan::text,  true);
  perform set_config('test.spare', v_spare::text, true);
  perform set_config('test.held',  v_held::text,  true);
  perform set_config('test.type',  v_type::text,  true);
end;
$$;

-- ============================================================================
-- A gym that has overridden nothing sees no change
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.archive_plan(current_setting('test.plan')::uuid) $$,
  'the owner still retires a plan'
);

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ select public.archive_class_type(current_setting('test.type')::uuid) $$,
  'and a coach still archives a class type, because that is the default'
);

select _test_act_as(current_setting('test.admin')::uuid);

select throws_ok(
  $$ select public.archive_plan(current_setting('test.spare')::uuid) $$,
  'Not authorised',
  'while an admin who was granted nothing is still refused a plan'
);

-- ============================================================================
-- A grant reaches the write it was sold as
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'admin', 'can_archive_plans', true);

select _test_act_as(current_setting('test.admin')::uuid);

select lives_ok(
  $$ select public.archive_plan(current_setting('test.spare')::uuid) $$,
  'the same admin retires a plan once the owner turns the switch on'
);

select lives_ok(
  $$ select public.restore_plan(current_setting('test.spare')::uuid) $$,
  'and puts it back, because restoring is the undo of the same permission'
);

select is(
  (select archived_at from public.membership_plans
    where plan_id = current_setting('test.spare')::uuid),
  null,
  'so the plan really is back on sale'
);

-- Deleting is a separate promise with its own switch, and the grant above
-- is not it.
select throws_ok(
  $$ select public.delete_plan(current_setting('test.spare')::uuid) $$,
  'Not authorised',
  'archiving does not quietly carry the right to delete'
);

select _test_act_as(current_setting('test.owner')::uuid);
insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'admin', 'can_hard_delete', true);

select _test_act_as(current_setting('test.admin')::uuid);

select throws_ok(
  $$ select public.delete_plan(current_setting('test.held')::uuid) $$,
  'Cannot delete: plan still has subscriptions. Archive instead.',
  'and a plan somebody is on is still refused, on the dependent check rather than the permission'
);

select lives_ok(
  $$ select public.delete_plan(current_setting('test.spare')::uuid) $$,
  'a plan nobody is on goes, now that the switch is on'
);

-- ============================================================================
-- A revocation reaches it too
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);
insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'coach', 'can_archive_classes', false);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.restore_class_type(current_setting('test.type')::uuid) $$,
  'Not authorised',
  'the coach who could archive a class type cannot once the owner takes it away'
);

-- ============================================================================
-- Leaving takes it with you
-- ============================================================================

select _test_act_as(current_setting('test.gone')::uuid);

select throws_ok(
  $$ select public.archive_plan(current_setting('test.plan')::uuid) $$,
  'Not authorised',
  'and an admin who has left the gym holds no capability there at all'
);

select finish();
rollback;
