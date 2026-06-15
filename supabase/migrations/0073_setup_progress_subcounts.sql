-- Per-step completeness in get_gym_setup_progress.
--
-- Until now each step was a binary done / not-done. The onboarding UI
-- wants to render a partial progress ring on steps that have natural
-- sub-items (e.g. "uploaded the light logo but not the dark logo"),
-- so the RPC grows two new columns:
--
--   complete  — sub-items satisfied so far
--   target    — sub-items expected for "fully complete"
--
-- For binary steps (logo present, plan exists, etc.) target = 1 and
-- the ring just snaps between 0/1 and 1/1 — same visual as before.
-- Multi-part steps now have meaningful in-between states:
--
--   logo       — light logo + dark logo (target = 2)
--   parq       — waiver + PAR-Q (target = 2; either alone still
--                marks the step "done")
--   schedule   — one sub-item per active class type, complete when
--                that class type has at least one recurrence
--
-- The boolean `done` keeps the same semantics so the redirect gate
-- in src/app/index.tsx and any existing client code keep working;
-- the new columns are additive.

begin;

-- CREATE OR REPLACE can't widen a RETURNS TABLE column set, so drop the
-- old shape first. The same body is re-created below; clients
-- re-codegen and pick up the two new columns.
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
  v_has_plan         boolean;
  v_has_invite       boolean;
  v_has_extra_member boolean;
  v_has_pending      boolean;
  v_has_tracked      boolean;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  -- Snapshot the per-step state up front so each row in the returned
  -- table is a quick projection rather than re-running the same
  -- existence subqueries. The class-type counts feed the schedule
  -- step's sub-item ratio.
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
    select 'class_type'::text, v_has_class_type,
      (case when v_has_class_type then 1 else 0 end), 1
    union all
    -- Schedule: complete = class types that have a recurrence; target
    -- = class types defined. Target floors at 1 so the ratio is well-
    -- defined while the owner is still on the prior step.
    select 'schedule'::text,
      v_scheduled_count > 0,
      v_scheduled_count,
      greatest(v_class_type_count, 1)
    union all
    -- Health screening: either alone marks `done` true; complete
    -- counts both so an owner can see "I have the waiver, the PAR-Q
    -- would round it out".
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
