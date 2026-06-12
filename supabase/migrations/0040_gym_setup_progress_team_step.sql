-- Add a sixth (optional) "team" step to the gym setup checklist.
--
-- The step is "done" when the owner has either generated an invite
-- code (the action they take), OR there's already at least one active
-- non-owner membership in the gym (covers the case where staff have
-- already joined). It's marked optional client-side — a solo coach
-- can legitimately leave it open, and the card auto-hides once every
-- non-optional step is done.

begin;

create or replace function public.get_gym_setup_progress(p_gym_id uuid)
returns table (step_key text, done boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
    select 'logo'::text,
      exists (
        select 1 from public.gyms
        where id = p_gym_id and coalesce(logo_url, '') <> ''
      )
    union all
    select 'class_type'::text,
      exists (
        select 1 from public.class_types
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'schedule'::text,
      exists (
        select 1
        from public.class_recurrences cr
        join public.class_types ct on ct.id = cr.class_type_id
        where cr.gym_id = p_gym_id and ct.archived_at is null
      )
    union all
    select 'parq'::text,
      exists (
        select 1 from public.parq_questionnaires
        where gym_id = p_gym_id and is_active
      )
    union all
    select 'plan'::text,
      exists (
        select 1 from public.membership_plans
        where gym_id = p_gym_id and archived_at is null
      )
    union all
    select 'team'::text,
      -- Generated an invite code yet, OR somebody non-owner has
      -- already joined (e.g. a co-founder added directly).
      exists (
        select 1 from public.invite_codes
        where gym_id = p_gym_id
      )
      or exists (
        select 1 from public.gym_memberships
        where gym_id = p_gym_id
          and role in ('admin', 'coach', 'staff')
          and left_at is null
      );
end;
$$;

commit;
