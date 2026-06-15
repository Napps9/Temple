-- Combine the "Add a class type" and "Set up a class schedule" steps
-- in the setup checklist. Both deep-link to /management/class-types
-- and the editor lets an owner do them in one go, so listing them
-- separately on the checklist was misleading.
--
-- The new 'class_type_and_schedule' step replaces both. It still
-- exposes meaningful in-between state via the existing complete /
-- target columns added in 0073: target = 2 (a class type + a
-- recurrence), complete = whichever of the two is satisfied.
--
-- `done` becomes "any class type exists" so the step flips green the
-- moment the owner adds their first type — the partial ring then
-- prompts them to set the schedule. This matches how owners actually
-- treat the editor (the schedule editor only opens after picking a
-- type).
--
-- REQUIRED step count drops from six to five. The redirect gate in
-- src/app/index.tsx already enumerates the required keys, so this
-- migration just changes the rows the RPC returns.

begin;

drop function if exists public.get_gym_setup_progress(uuid);

create function public.get_gym_setup_progress(p_gym_id uuid)
returns table (
  step_key text,
  done     boolean,
  complete integer,
  target   integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_class_type_count int;
  v_scheduled_count  int;
  v_has_light_logo   boolean;
  v_has_dark_logo    boolean;
  v_has_settings     boolean;
  v_has_parq         boolean;
  v_has_waiver       boolean;
  v_has_class_type   boolean;
  v_has_schedule     boolean;
  v_has_plan         boolean;
  v_has_invite       boolean;
  v_has_extra_member boolean;
  v_has_pending      boolean;
  v_has_tracked      boolean;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  select coalesce(logo_url, '') <> '',
         coalesce(logo_url_dark, '') <> '',
         operating_defaults_reviewed_at is not null
    into v_has_light_logo, v_has_dark_logo, v_has_settings
    from public.gyms where id = p_gym_id;

  select count(*) into v_class_type_count
    from public.class_types
    where gym_id = p_gym_id and archived_at is null;
  v_has_class_type := v_class_type_count > 0;

  select count(distinct ct.id) into v_scheduled_count
    from public.class_types ct
    where ct.gym_id = p_gym_id and ct.archived_at is null
      and exists (
        select 1 from public.class_recurrences cr where cr.class_type_id = ct.id
      );
  v_has_schedule := v_scheduled_count > 0;

  v_has_parq := exists (
    select 1 from public.parq_questionnaires
    where gym_id = p_gym_id and is_active
  );
  v_has_waiver := exists (
    select 1 from public.waiver_documents
    where gym_id = p_gym_id and is_active
  );
  v_has_plan := exists (
    select 1 from public.membership_plans
    where gym_id = p_gym_id and archived_at is null
  );
  v_has_invite := exists (
    select 1 from public.invite_codes where gym_id = p_gym_id
  );
  v_has_extra_member := exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id
      and role in ('admin', 'coach', 'staff')
      and left_at is null
  );
  v_has_pending := exists (
    select 1 from public.pending_members where gym_id = p_gym_id
  );
  v_has_tracked := exists (
    select 1 from public.tracked_workouts where gym_id = p_gym_id
  );

  return query
    select 'logo'::text,
      v_has_light_logo,
      (case when v_has_light_logo then 1 else 0 end)
        + (case when v_has_dark_logo then 1 else 0 end),
      2
    union all
    select 'settings'::text, v_has_settings,
      (case when v_has_settings then 1 else 0 end), 1
    union all
    -- Combined: class type + schedule. Done flips on the first class
    -- type (so progress feels immediate); the ring fills the rest of
    -- the way once the schedule is set.
    select 'class_type_and_schedule'::text,
      v_has_class_type,
      (case when v_has_class_type then 1 else 0 end)
        + (case when v_has_schedule then 1 else 0 end),
      2
    union all
    select 'parq'::text,
      v_has_parq or v_has_waiver,
      (case when v_has_parq then 1 else 0 end)
        + (case when v_has_waiver then 1 else 0 end),
      2
    union all
    select 'plan'::text, v_has_plan,
      (case when v_has_plan then 1 else 0 end), 1
    union all
    select 'team'::text,
      v_has_invite or v_has_extra_member,
      (case when v_has_invite or v_has_extra_member then 1 else 0 end), 1
    union all
    select 'members_imported'::text, v_has_pending,
      (case when v_has_pending then 1 else 0 end), 1
    union all
    select 'workouts_imported'::text, v_has_tracked,
      (case when v_has_tracked then 1 else 0 end), 1;
end;
$$;

grant execute on function public.get_gym_setup_progress(uuid) to authenticated;

commit;
