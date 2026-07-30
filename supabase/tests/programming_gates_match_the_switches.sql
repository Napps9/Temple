-- Programming and task gates match the switches (0219).
--
-- The pair that matters, three times over: the same coach, allowed by
-- default and refused once the owner turns the switch off. That override
-- has never worked on any of these tables, because the policies asked a
-- raw role rather than the capability.
--
-- The quieter assertions are left_at and the silent one. Somebody who
-- left the gym kept writing programming; and a non-owner granted
-- can_manage_plans got a DELETE on plan_class_types that removed nothing
-- and reported nothing, so a plan could end up programming-only while
-- still carrying class types.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@proggate.test');
  v_coach uuid := _test_mk_user('coach@proggate.test');
  v_gone  uuid := _test_mk_user('gone@proggate.test');
  v_gym   uuid := _test_mk_gym('Prog Gate', 'proggate');
  v_ct    uuid;
  v_plan  uuid;
  v_task  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_gone,  'coach');
  update public.gym_memberships set left_at = now()
    where gym_id = v_gym and profile_id = v_gone;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#2563EB') returning id into v_ct;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;
  insert into public.plan_class_types (plan_id, class_type_id)
    values (v_plan, v_ct);
  insert into public.coach_tasks (gym_id, assigned_to, created_by, title, status)
    values (v_gym, v_coach, v_owner, 'Mop the place', 'open') returning id into v_task;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.ct',    v_ct::text,    true);
  perform set_config('test.plan',  v_plan::text,  true);
  perform set_config('test.task',  v_task::text,  true);
end;
$$;

-- ============================================================================
-- Default behaviour is unchanged
-- ============================================================================

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ insert into public.class_programming (gym_id, class_type_id, date, sections, author_id)
     values (current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
             current_date, '[]'::jsonb, current_setting('test.coach')::uuid) $$,
  'a coach still writes programming, because can_edit_classes defaults to their role'
);

select lives_ok(
  $$ insert into public.programming_blocks (gym_id, name, starts_on, ends_on, color, created_by)
     values (current_setting('test.gym')::uuid, 'Open prep', current_date,
             current_date + 28, '#3B82F6', current_setting('test.coach')::uuid) $$,
  'and still blocks out the year'
);

select is(
  (select count(*)::int from public.programming_blocks
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'and can read the block back — write without read would be worse than neither'
);

-- ============================================================================
-- The owner's override finally does something
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled) values
  (current_setting('test.gym')::uuid, 'coach', 'can_edit_classes', false),
  (current_setting('test.gym')::uuid, 'coach', 'can_manage_tasks', false);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ insert into public.class_programming (gym_id, class_type_id, date, sections, author_id)
     values (current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
             current_date + 1, '[]'::jsonb, current_setting('test.coach')::uuid) $$,
  '42501',
  null,
  'the same coach cannot write programming once the owner turns it off'
);

select throws_ok(
  $$ insert into public.programming_blocks (gym_id, name, starts_on, ends_on, color, created_by)
     values (current_setting('test.gym')::uuid, 'Nope', current_date,
             current_date + 7, '#3B82F6', current_setting('test.coach')::uuid) $$,
  '42501',
  null,
  'nor block out the year'
);

select is(
  (select count(*)::int from public.programming_blocks
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'and the Year view goes empty for them rather than half-working'
);

select throws_ok(
  $$ insert into public.coach_tasks (gym_id, assigned_to, created_by, title, status)
     values (current_setting('test.gym')::uuid, current_setting('test.coach')::uuid,
             current_setting('test.coach')::uuid, 'Nope', 'open') $$,
  '42501',
  null,
  'nor hand out a task'
);

-- The assignee-self branch is what lets somebody tick off their own work,
-- and it must survive a capability being taken away.
select lives_ok(
  $$ select public.complete_task(current_setting('test.task')::uuid) $$,
  'but still ticks off the task that is theirs — that branch never needed a capability'
);

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ insert into public.class_programming (gym_id, class_type_id, date, sections, author_id)
     values (current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
             current_date + 2, '[]'::jsonb, current_setting('test.owner')::uuid) $$,
  'while the owner carries on regardless'
);

-- ============================================================================
-- Leaving the gym takes it with you
-- ============================================================================

select _test_act_as(current_setting('test.gone')::uuid);

select throws_ok(
  $$ insert into public.class_programming (gym_id, class_type_id, date, sections, author_id)
     values (current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
             current_date + 3, '[]'::jsonb, current_setting('test.gone')::uuid) $$,
  '42501',
  null,
  'a coach who has left the gym cannot write its programming — the raw helper never checked'
);

-- ============================================================================
-- The allowlist follows its parent, and stops failing silently
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'admin', 'can_manage_plans', true);

select _test_act_as(current_setting('test.coach')::uuid);

delete from public.plan_class_types
  where plan_id = current_setting('test.plan')::uuid;

select is(
  (select count(*)::int from public.plan_class_types
    where plan_id = current_setting('test.plan')::uuid),
  1,
  'a coach without can_manage_plans still removes nothing from a plan allowlist'
);

select _test_act_as(current_setting('test.owner')::uuid);

delete from public.plan_class_types
  where plan_id = current_setting('test.plan')::uuid;

select is(
  (select count(*)::int from public.plan_class_types
    where plan_id = current_setting('test.plan')::uuid),
  0,
  'and somebody who may manage plans actually clears it, rather than a silent 204'
);

select finish();
rollback;
