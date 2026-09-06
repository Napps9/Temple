-- 0245 made delete_class_type and delete_plan the deletes that check
-- can_hard_delete and refuse a row that still has dependents. Both
-- tables kept a row-level delete policy from before that work
-- (class_types_coach_delete from 0004, membership_plans_manage_delete
-- from 0215), so a client with can_manage_classes or can_manage_plans
-- could still send a plain DELETE through PostgREST and skip both
-- checks: no capability, no dependents guard, a class type gone from
-- under its sessions. The RPCs run as their owner, so they do not need
-- the grant; nothing else does. The RPC is the only door.

drop policy if exists class_types_coach_delete on public.class_types;
drop policy if exists membership_plans_manage_delete on public.membership_plans;

revoke delete on public.class_types from authenticated;
revoke delete on public.membership_plans from authenticated;
