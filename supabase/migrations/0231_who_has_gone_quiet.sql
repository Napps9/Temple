-- Who has stopped coming
--
-- The one question in this batch that has no screen behind it. "How busy
-- have we been" is the attendance page said out loud; "what did we take"
-- is the money block; "who has gone quiet" is nowhere. The retention tick
-- (0208) computes it nightly to decide who to propose a message about,
-- and throws the working away — an owner cannot ask, and the three
-- proposals a day the loop is allowed to make are deliberately not the
-- whole list.
--
-- Doing it from the client is the obvious alternative and is wrong twice.
-- It would mean pulling every attendance row for the gym and taking a max
-- per member in JavaScript, which is thousands of rows for a busy gym and
-- silently truncated at PostgREST's default limit — an answer that is
-- confidently short rather than wrong-looking. And the aggregate is one
-- index scan in Postgres.
--
-- Two things the shape has to get right, both about not crying wolf:
--
--   * Somebody who joined last week and has not been in is not quiet,
--     they are new. Members who have never attended only count once they
--     have been on the books longer than the window itself.
--   * Somebody who never attended at all is not the same fact as somebody
--     who came every week until March. last_seen is null for the first
--     and weeks_absent is null with it, rather than a made-up number, so
--     the surface can say which it is.
--
-- Gated on can_view_attendance: it is the attendance page's data, and the
-- coach who takes the register is exactly who should be able to ask.

create or replace function public.gym_quiet_members(
  p_gym_id uuid,
  p_weeks  integer default 4
) returns table (
  profile_id   uuid,
  full_name    text,
  last_seen    timestamptz,
  weeks_absent integer,
  paying       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks  integer := least(greatest(coalesce(p_weeks, 4), 1), 52);
  v_cutoff timestamptz;
begin
  if not public.effective_can(p_gym_id, 'can_view_attendance') then
    raise exception 'Not authorised';
  end if;
  v_cutoff := now() - make_interval(weeks => v_weeks);

  return query
  select gm.profile_id,
         p.full_name,
         seen.last_seen,
         case
           when seen.last_seen is null then null
           else greatest(
             1,
             floor(extract(epoch from now() - seen.last_seen) / 604800)::integer
           )
         end,
         exists (
           select 1 from public.plan_subscriptions ps
            where ps.gym_id = gm.gym_id
              and ps.profile_id = gm.profile_id
              and ps.status = 'active'
         )
    from public.gym_memberships gm
    join public.profiles p on p.id = gm.profile_id
    left join lateral (
      select max(cb.attended_at) as last_seen
        from public.class_bookings cb
       where cb.gym_id = gm.gym_id
         and cb.profile_id = gm.profile_id
         and cb.attended_at is not null
    ) seen on true
   where gm.gym_id = p_gym_id
     and gm.role = 'member'
     and gm.left_at is null
     and case
           when seen.last_seen is null then gm.created_at < v_cutoff
           else seen.last_seen < v_cutoff
         end
   -- Longest gone first, and a member who never came sorts by how long
   -- they have been on the books — six months a member and never once
   -- through the door is the one worth seeing at the top.
   order by coalesce(seen.last_seen, gm.created_at) asc;
end;
$$;

revoke all on function public.gym_quiet_members(uuid, integer) from public, anon;
grant execute on function public.gym_quiet_members(uuid, integer) to authenticated;
