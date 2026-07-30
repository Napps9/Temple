-- The programming and task gates match the switches that describe them
--
-- Sixth, seventh and eighth of this class. Same shape every time: a
-- screen gates itself on a capability, and the policy behind it asks a
-- raw-role helper instead. The helper is not a capability — it ignores
-- both the per-role and the per-member override, and it has no left_at
-- guard, so somebody who left the gym keeps writing.
--
--  1. class_programming. programming.tsx:13 gates on
--     useCan('can_edit_classes'); class_programming_coach_write asks
--     user_can_manage_classes (0007:30), which is bare
--     role in ('owner','admin','coach') (0013:97).
--
--  2. programming_blocks. Same helper on both select and write (0205:32).
--     Both move together on purpose: a gate that lets somebody write a
--     block they cannot then read is worse than either gate alone.
--
--  3. coach_tasks. tasks.tsx:50 gates on useCan('can_manage_tasks'); the
--     three write policies ask user_can_admin_or_coach (0013:289), and so
--     do complete_task and reopen_task (0014:453, 0014:488). The
--     assignee-self branch in both RPCs is untouched — that is what lets
--     the person a task belongs to tick it off.
--
-- Default behaviour does not change: default_capability gives
-- can_edit_classes and can_manage_tasks to admin and coach (0169:66,73),
-- which is who the helpers already admitted. What changes is that an
-- owner's override finally does something, that leaving the gym takes the
-- access with it, and that a `staff`-role person granted the capability on
-- the Team screen gets what that screen promised them.
--
-- Fourth change, different family but the same silence:
--
--  4. plan_class_types. 0215 moved membership_plans to
--     effective_can(gym_id,'can_manage_plans') and left its allowlist
--     child on user_is_owner_of (0008:105,113). So a non-owner granted
--     can_manage_plans switching a plan to programming_only gets a
--     successful UPDATE on the plan and a DELETE on the class types that
--     removes nothing — a row-filtered DELETE returns 204 with no error,
--     and plans.tsx:452 does not .select(), so nothing anywhere reports
--     it. The plan ends up programming-only while still carrying class
--     types. This is my asymmetry, introduced in 0215; closing it here.
--     Widens to capability holders in principle, but can_manage_plans
--     defaults to false for every non-owner role, so nothing moves until
--     an owner grants it deliberately.

-- ---------------------------------------------------------------------------
-- 1. Writing programming
-- ---------------------------------------------------------------------------

drop policy if exists class_programming_coach_write on public.class_programming;

create policy class_programming_edit_write on public.class_programming
  for all
  using (public.effective_can(gym_id, 'can_edit_classes'))
  with check (public.effective_can(gym_id, 'can_edit_classes'));

-- ---------------------------------------------------------------------------
-- 2. The year plan
-- ---------------------------------------------------------------------------

drop policy if exists programming_blocks_coach_select on public.programming_blocks;
drop policy if exists programming_blocks_coach_write on public.programming_blocks;

create policy programming_blocks_edit_select on public.programming_blocks
  for select using (public.effective_can(gym_id, 'can_edit_classes'));

create policy programming_blocks_edit_write on public.programming_blocks
  for all
  using (public.effective_can(gym_id, 'can_edit_classes'))
  with check (public.effective_can(gym_id, 'can_edit_classes'));

-- ---------------------------------------------------------------------------
-- 3. Tasks
-- ---------------------------------------------------------------------------

drop policy if exists coach_tasks_admin_insert on public.coach_tasks;
drop policy if exists coach_tasks_admin_update on public.coach_tasks;
drop policy if exists coach_tasks_admin_delete on public.coach_tasks;

create policy coach_tasks_manage_insert on public.coach_tasks
  for insert with check (public.effective_can(gym_id, 'can_manage_tasks'));
create policy coach_tasks_manage_update on public.coach_tasks
  for update using (public.effective_can(gym_id, 'can_manage_tasks'))
  with check (public.effective_can(gym_id, 'can_manage_tasks'));
create policy coach_tasks_manage_delete on public.coach_tasks
  for delete using (public.effective_can(gym_id, 'can_manage_tasks'));

-- complete_task / reopen_task: the same swap, and nothing else. The
-- assignee-self branch stays exactly as 0014 wrote it — a task's own
-- owner ticking it off has never needed a capability and must not start.

create or replace function public.complete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_task public.coach_tasks;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.coach_tasks where id = p_task_id;
  if v_task is null then
    raise exception 'Task not found';
  end if;
  if v_task.assigned_to <> v_uid and not public.effective_can(v_task.gym_id, 'can_manage_tasks') then
    raise exception 'Not authorised';
  end if;

  if v_task.status = 'done' then
    return;
  end if;

  update public.coach_tasks
    set status = 'done', completed_at = now()
    where id = p_task_id;
end;
$$;

create or replace function public.reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_task public.coach_tasks;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.coach_tasks where id = p_task_id;
  if v_task is null then
    raise exception 'Task not found';
  end if;
  if v_task.assigned_to <> v_uid and not public.effective_can(v_task.gym_id, 'can_manage_tasks') then
    raise exception 'Not authorised';
  end if;

  if v_task.status = 'open' then
    return;
  end if;

  update public.coach_tasks
    set status = 'open', completed_at = null
    where id = p_task_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A plan's class-type allowlist follows its parent
-- ---------------------------------------------------------------------------

drop policy if exists plan_class_types_owner_insert on public.plan_class_types;
drop policy if exists plan_class_types_owner_delete on public.plan_class_types;

create policy plan_class_types_manage_insert on public.plan_class_types
  for insert with check (
    exists (
      select 1 from public.membership_plans mp
      where mp.plan_id = plan_class_types.plan_id
        and public.effective_can(mp.gym_id, 'can_manage_plans')
    )
  );

create policy plan_class_types_manage_delete on public.plan_class_types
  for delete using (
    exists (
      select 1 from public.membership_plans mp
      where mp.plan_id = plan_class_types.plan_id
        and public.effective_can(mp.gym_id, 'can_manage_plans')
    )
  );
