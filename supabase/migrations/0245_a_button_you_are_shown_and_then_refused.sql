-- The archive buttons ask one question and the database answers another
--
-- Found while auditing the plans screen for what a sentence could replace.
-- Six RPCs from 0017 — archive/restore/delete for plans and for class types
-- — predate the capability matrix (0020) and still authorise with the
-- role predicates that were all there was at the time. Every one of them
-- is now fronted by a button gated on a capability the server never reads,
-- and the two halves disagree in both directions:
--
--   can_archive_plans is offered on the Team screen as "Retire plans
--   without deleting their history". An owner grants it to an admin; the
--   Archive and Restore buttons appear for them; archive_plan asks
--   user_is_owner_of and raises 'Not authorised'. Same for can_hard_delete
--   and delete_plan. A capability that reads as permission and is
--   decoration — 0211 (can_assign_plan), 0213 (can_issue_override) and
--   0215 (can_manage_plans) each fixed one instance of this.
--
--   can_archive_classes runs the other way. It defaults to admin+coach,
--   which is exactly what user_can_admin_or_coach means, so at defaults
--   nothing is wrong. Revoke it from coaches, though, and the button
--   disappears while the RPC keeps saying yes — an owner who has taken a
--   permission away still has coaches who can archive a class type by
--   calling the function directly. The looser failure of the two: the
--   first refuses someone who was promised access, this one admits
--   someone who was told they had none.
--
-- effective_can is the fix for both. It returns true for owner
-- unconditionally, so no gym that has granted nothing sees any change,
-- and it consults the per-person override before the per-role one, so a
-- grant or a revocation finally reaches the write. It is also the
-- stricter predicate: it requires left_at is null, which neither
-- user_is_owner_of nor user_can_admin_or_coach does, so a departed admin
-- stops being able to archive the plans of a gym they have left.
--
-- Bodies are otherwise 0017 verbatim, including the dependent checks and
-- their messages. Signatures are unchanged, so CREATE OR REPLACE is safe
-- and no caller needs touching.

-- ---------------------------------------------------------------------------
-- Class types
-- ---------------------------------------------------------------------------

create or replace function public.archive_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.effective_can(v_gym, 'can_archive_classes') then
    raise exception 'Not authorised';
  end if;
  update public.class_types
    set archived_at = now()
    where id = p_id and archived_at is null;
end;
$$;

create or replace function public.restore_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.effective_can(v_gym, 'can_archive_classes') then
    raise exception 'Not authorised';
  end if;
  update public.class_types set archived_at = null where id = p_id;
end;
$$;

create or replace function public.delete_class_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_types where id = p_id;
  if v_gym is null then
    raise exception 'Class type not found';
  end if;
  if not public.effective_can(v_gym, 'can_hard_delete') then
    raise exception 'Not authorised';
  end if;
  if public.class_type_has_dependents(p_id) then
    raise exception 'Cannot delete: class type still has sessions, recurrences, programming or plan allowlist entries. Archive instead.';
  end if;
  delete from public.class_types where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership plans
-- ---------------------------------------------------------------------------

create or replace function public.archive_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.effective_can(v_gym, 'can_archive_plans') then
    raise exception 'Not authorised';
  end if;
  update public.membership_plans
    set archived_at = now()
    where plan_id = p_plan_id and archived_at is null;
end;
$$;

create or replace function public.restore_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.effective_can(v_gym, 'can_archive_plans') then
    raise exception 'Not authorised';
  end if;
  update public.membership_plans
    set archived_at = null
    where plan_id = p_plan_id;
end;
$$;

create or replace function public.delete_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.membership_plans where plan_id = p_plan_id;
  if v_gym is null then
    raise exception 'Plan not found';
  end if;
  if not public.effective_can(v_gym, 'can_hard_delete') then
    raise exception 'Not authorised';
  end if;
  if public.plan_has_dependents(p_plan_id) then
    raise exception 'Cannot delete: plan still has subscriptions. Archive instead.';
  end if;
  delete from public.membership_plans where plan_id = p_plan_id;
end;
$$;
