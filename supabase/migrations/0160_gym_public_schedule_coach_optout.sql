-- Site builder — optional coach-name privacy control on the public schedule.
--
-- gym_public_schedule returned every scheduled coach's full name to anon
-- with no way to opt out. This honours a document-level setting
-- (settings.showCoachNames): when the owner sets it false, coach_name comes
-- back null from the RPC itself — not merely hidden in the renderer — so the
-- raw anon response can't leak it either (same discipline as the Team
-- block's hide-list, 0158). Read from the published snapshot. Absent or true
-- keeps today's behaviour.
--
-- Return shape is unchanged, so CREATE OR REPLACE (grants preserved).

begin;

create or replace function public.gym_public_schedule(p_slug text)
returns table (
  session_id        uuid,
  starts_at         timestamptz,
  duration_minutes  int,
  class_type_name   text,
  class_type_color  text,
  coach_name        text
)
language sql
security definer
stable
set search_path = public
as $$
  select cs.id, cs.starts_at, cs.duration_minutes,
         ct.name, ct.color,
         case
           when coalesce(w.published_design, w.design) #>> '{settings,showCoachNames}' = 'false'
             then null
           else p.full_name
         end
  from public.class_sessions cs
  join public.gyms g on g.id = cs.gym_id
  join public.gym_websites w on w.gym_id = g.id and w.published = true
  left join public.class_types ct on ct.id = cs.class_type_id
  left join public.profiles p on p.id = cs.coach_id
  where g.slug = lower(p_slug)
    and cs.starts_at >= date_trunc('day', now())
    and cs.starts_at < now() + interval '7 days'
  order by cs.starts_at
  limit 50;
$$;

commit;
