-- Who else was in the room
--
-- A class-linked journal entry knows which session it came from, but a
-- member scrolling their own history sees only themselves. The people
-- they actually trained beside are already visible on the class
-- leaderboard — same room, same workout — so the journal can say so,
-- under exactly the same consent.
--
-- One batch RPC: for a set of class sessions, the OTHER members who
-- logged the same session. The gate is the leaderboard gate, reused
-- deliberately rather than a new toggle: gym_memberships.
-- appear_in_leaderboards (self-set via set_appear_in_leaderboards,
-- 0028) plus the gym's class_leaderboards_enabled switch — someone who
-- opted out of being seen is not seen here either, and a gym that
-- turned leaderboards off shows nobody. Sessions in gyms the caller
-- does not belong to are silently filtered, not raised: the input is a
-- batch and the caller cannot help holding history from a gym they
-- have left.

begin;

create function public.class_session_training_partners(p_session_ids uuid[])
returns table (
  class_session_id uuid,
  profile_id       uuid,
  full_name        text,
  avatar_url       text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.class_session_id,
    w.profile_id,
    coalesce(pr.full_name, 'Member') as full_name,
    pr.avatar_url
  from (
    select distinct tw.class_session_id, tw.profile_id, cs.gym_id
    from public.tracked_workouts tw
    join public.class_sessions cs on cs.id = tw.class_session_id
    where tw.class_session_id = any(p_session_ids)
  ) w
  join public.gyms g
    on g.id = w.gym_id and g.class_leaderboards_enabled
  join public.gym_memberships m
    on m.gym_id = w.gym_id
   and m.profile_id = w.profile_id
   and m.appear_in_leaderboards
   and m.left_at is null
  join public.profiles pr on pr.id = w.profile_id
  where w.profile_id <> auth.uid()
    and public.user_belongs_to(w.gym_id)
  order by w.class_session_id, coalesce(pr.full_name, '');
$$;

revoke all on function public.class_session_training_partners(uuid[])
  from public, anon;
grant execute on function public.class_session_training_partners(uuid[])
  to authenticated;

commit;
