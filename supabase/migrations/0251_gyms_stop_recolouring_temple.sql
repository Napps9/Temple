-- Gyms stop recolouring Temple.
--
-- A gym used to set six hexes and upload two logos, and the app rendered
-- itself in them: the nav mark, every primary button, the PWA icon, the
-- browser tab. Temple's chrome is Temple's now, and a gym is identified
-- by its name.
--
-- Two consequences here.
--
-- 1. The setup checklist loses its `logo` step. It was one of six
--    required steps, computed from gyms.logo_url / logo_url_dark, and a
--    step whose surface no longer exists can never be completed — an
--    owner would sit permanently at five of six. The RETURNS shape is
--    unchanged (one row fewer, not a new column), so CREATE OR REPLACE
--    is safe; this is not the 0043 case.
--
-- 2. set_gym_branding is dropped. Nothing calls it any more — the
--    Branding card, the create-gym colour step and the agent's
--    gym.set_colour action all went with the feature. set_gym_name and
--    set_gym_slug still carry everything the Gym details card saves.
--
-- The gyms columns themselves stay. primary_color, logo_url and their
-- _dark partners stop being read by the app, but dropping them would
-- destroy data a gym supplied and buy nothing, and api/site still serves
-- an already-published website from the snapshot it took of them.

begin;

create or replace function public.get_gym_setup_progress(p_gym_id uuid)
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
  v_has_settings     boolean;
  v_has_parq         boolean;
  v_has_waiver       boolean;
  v_has_class_type   boolean;
  v_has_schedule     boolean;
  v_has_stripe       boolean;
  v_has_plan         boolean;
  v_has_invite       boolean;
  v_has_extra_member boolean;
  v_has_pending      boolean;
  v_has_tracked      boolean;
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  select operating_defaults_reviewed_at is not null
    into v_has_settings
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
  v_has_stripe := exists (
    select 1 from public.gym_stripe_accounts where gym_id = p_gym_id
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
    select 'settings'::text, v_has_settings,
      (case when v_has_settings then 1 else 0 end), 1
    union all
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
    select 'stripe'::text, v_has_stripe,
      (case when v_has_stripe then 1 else 0 end), 1
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

drop function if exists public.set_gym_branding(
  uuid, text, text, text, text, text, text, text, text
);

commit;
