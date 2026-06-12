-- Gym setup checklist for new owners.
--
-- Rather than seed task rows on gym creation (which would then need to
-- be kept in sync with the actual gym state — "I uploaded a logo but
-- the task says I didn't"), the checklist is heuristic: each step
-- asks the database "is this set up?" against the concrete table that
-- backs the feature. Complete the action, the step flips done. Delete
-- the thing, the step flips back. Always true.
--
-- Five core steps cover the path from "I just made a gym" to "members
-- can join, pay, and book":
--   logo         — gyms.logo_url is set
--   class_type   — at least one active class_types row
--   schedule     — at least one class_recurrences row tied to an
--                  active class type, so members see classes appear
--                  on the calendar
--   parq         — an active PAR-Q questionnaire, which is also the
--                  thing that turns the booking-time PAR-Q gate on
--                  (0038)
--   plan         — at least one active membership plan, so members
--                  can subscribe
--
-- Team invites are intentionally not in the core list: a solo coach
-- is a valid configuration, and inviting team members is discoverable
-- from the Team tab.

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
      );
end;
$$;

grant execute on function public.get_gym_setup_progress(uuid) to authenticated;

commit;
