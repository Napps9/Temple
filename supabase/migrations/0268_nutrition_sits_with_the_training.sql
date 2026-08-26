-- Nutrition sits with the training
--
-- ACE keep protein, carbs and fat for each member in a spreadsheet beside
-- Temple, which means the coach who wrote the programme and the coach who
-- set the macros are looking at two different documents about the same
-- person. This is the smaller half of that: the targets, on the member,
-- written by a coach and read by the member.
--
-- CALORIES ARE DERIVED, NOT STORED. 4/4/9 is exact, and a stored kcal
-- column is a second number that can disagree with the first three. The
-- client computes it for display; nothing here keeps it.
--
-- NUMBERS ONLY, AND THAT IS THE ARTICLE 9 DECISION. A protein target is a
-- coaching prescription, not a health disclosure — it says what the coach
-- wants, not what is wrong with anybody. A free-text note beside it would
-- be a different thing entirely ("cutting for her wedding", "IBS flare"),
-- and that is the line: there is no note field, so this stays out of
-- _erase_member_health_data and out of log_health_data_access. If a note
-- is ever wanted, it is a health field and it arrives with the erasure
-- sweep and the audit log attached, not by widening this table.
--
-- AND NO FOOD LOG. Targets alone are a complete job. Intake is a separate
-- table when it comes — with a source column from day one, so a day typed
-- by hand and a day imported from somewhere else stay distinguishable.
-- Putting intake columns on a prescription is what would make that
-- impossible later.

begin;

-- ============================================================================
-- 1. The capability
-- ============================================================================

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_work_leads'        then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_program_members'        then p_role in ('admin','coach')
    when 'can_review_ai_calls'        then p_role = 'admin'
    when 'can_bulk_edit_classes'      then p_role = 'admin'
    -- Same people who write a programme, because it is the same job on
    -- the same member — but its own key, so a gym with one nutrition
    -- coach can say so without handing out the programming editor.
    when 'can_set_macro_targets'      then p_role in ('admin','coach')
    else false
  end;
$$;

-- ============================================================================
-- 2. The targets
-- ============================================================================

create table public.member_macro_targets (
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  protein_g  integer not null check (protein_g between 0 and 1000),
  carbs_g    integer not null check (carbs_g   between 0 and 1000),
  fat_g      integer not null check (fat_g     between 0 and 1000),
  set_by     uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (gym_id, profile_id)
);

comment on table public.member_macro_targets is
  'A coach''s macro prescription for one member. Numbers only and no note '
  'field, deliberately — see 0268. Calories are 4/4/9 at the surface, '
  'never stored, so the two cannot disagree.';

alter table public.member_macro_targets enable row level security;

-- The member reads their own. Staff read only if they could set them —
-- 0263's rule: a coach browsing everyone's numbers is a different ask
-- with its own key, not a side effect of this one.
create policy member_macro_targets_self_select on public.member_macro_targets
  for select using (profile_id = auth.uid());

create policy member_macro_targets_staff_select on public.member_macro_targets
  for select using (public.effective_can(gym_id, 'can_set_macro_targets'));

-- No write policy: set_member_macro_targets is the only way in.

-- ============================================================================
-- 3. Writing them
-- ============================================================================

create or replace function public.set_member_macro_targets(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_protein_g  integer,
  p_carbs_g    integer,
  p_fat_g      integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_set_macro_targets') then
    raise exception 'Not authorised';
  end if;
  if p_protein_g is null or p_carbs_g is null or p_fat_g is null then
    raise exception 'Every macro needs a number';
  end if;
  if p_protein_g < 0 or p_carbs_g < 0 or p_fat_g < 0
     or p_protein_g > 1000 or p_carbs_g > 1000 or p_fat_g > 1000 then
    raise exception 'Macros must be between 0 and 1000 grams';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_profile_id
      and gm.left_at is null
  ) then
    raise exception 'Member not found in this gym';
  end if;

  insert into public.member_macro_targets
    (gym_id, profile_id, protein_g, carbs_g, fat_g, set_by, updated_at)
  values
    (p_gym_id, p_profile_id, p_protein_g, p_carbs_g, p_fat_g, auth.uid(), now())
  on conflict (gym_id, profile_id) do update
    set protein_g  = excluded.protein_g,
        carbs_g    = excluded.carbs_g,
        fat_g      = excluded.fat_g,
        set_by     = excluded.set_by,
        updated_at = now();
end;
$$;

revoke all on function public.set_member_macro_targets(uuid, uuid, integer, integer, integer)
  from public, anon;
grant execute on function public.set_member_macro_targets(uuid, uuid, integer, integer, integer)
  to authenticated;

-- Clearing them is its own verb: a member with no targets and a member
-- with targets of zero are different states.
create or replace function public.clear_member_macro_targets(
  p_gym_id     uuid,
  p_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_set_macro_targets') then
    raise exception 'Not authorised';
  end if;
  delete from public.member_macro_targets
   where gym_id = p_gym_id and profile_id = p_profile_id;
end;
$$;

revoke all on function public.clear_member_macro_targets(uuid, uuid) from public, anon;
grant execute on function public.clear_member_macro_targets(uuid, uuid) to authenticated;

commit;
