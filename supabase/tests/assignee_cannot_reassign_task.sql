-- Invariant: task assignees can only toggle status via the
-- complete_task / reopen_task RPCs. A direct UPDATE on coach_tasks
-- by an assignee (who is not also admin/coach) must be rejected by
-- RLS, even when they're updating only their own row.
--
-- This is the structural fix from the plan: RLS WITH CHECK only sees
-- the new row, so a self-update policy can't enforce "status-only
-- changes". The fix is to route assignee updates through SECURITY
-- DEFINER RPCs that pin exactly which columns change.

begin;
select plan(3);

\ir _helpers.sql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@task.test');
  v_admin  uuid := _test_mk_user('admin@task.test');
  v_staff  uuid := _test_mk_user('staff@task.test');
  v_gym    uuid := _test_mk_gym('Task Gym', 'task');
  v_task   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_staff, 'staff');

  -- Admin assigns a task to the staff member.
  perform _test_act_as(v_admin);
  insert into public.coach_tasks
    (gym_id, assigned_to, created_by, title, due_date)
  values
    (v_gym, v_staff, v_admin, 'Open the building', '2026-12-31')
  returning id into v_task;

  perform set_config('test.task', v_task::text, true);
  perform set_config('test.staff', v_staff::text, true);
  perform set_config('test.admin', v_admin::text, true);
end;
$$;

-- 1. Staff trying a direct UPDATE: should affect 0 rows (RLS rejects).
do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.staff'), true);
  perform set_config('role', 'authenticated', true);
  update public.coach_tasks
    set due_date = '2027-01-01', assigned_to = current_setting('test.admin')::uuid
    where id = current_setting('test.task')::uuid;
end;
$$;

select is(
  (select due_date::text
   from public.coach_tasks
   where id = current_setting('test.task')::uuid),
  '2026-12-31',
  'staff direct UPDATE blocked by RLS — due_date unchanged'
);

select is(
  (select assigned_to::text
   from public.coach_tasks
   where id = current_setting('test.task')::uuid),
  current_setting('test.staff'),
  'staff direct UPDATE blocked by RLS — assigned_to unchanged'
);

-- 2. complete_task RPC succeeds for the assignee.
do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.staff'), true);
  perform set_config('role', 'authenticated', true);
  perform complete_task(current_setting('test.task')::uuid);
end;
$$;

select is(
  (select status::text
   from public.coach_tasks
   where id = current_setting('test.task')::uuid),
  'done',
  'complete_task RPC succeeds for the assignee'
);

select * from finish();
rollback;
