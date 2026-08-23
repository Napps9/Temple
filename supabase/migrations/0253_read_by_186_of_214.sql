-- Read by 186 of 214
--
-- An announcement is the owner speaking to the whole gym, and until now
-- the room gave nothing back: no way to know whether the bank-holiday
-- closure reached twenty people or two hundred. The reads have been
-- recorded since 0029 (announcement_reads, one row per member per
-- announcement) — nothing ever counted them.
--
-- This function counts them, and only counts them. It returns two
-- integers — how many current members have read the announcement, and
-- how many current members there are — and never a name. RLS on
-- announcement_reads stays self-only; the aggregate is the product.
--
-- STAFF ONLY, by the owner's explicit call: the count is a reach
-- measure for the person who posts, not a social score for the people
-- who read. A member sees their own read state and nothing about
-- anyone else's. The gate is can_post_announcements — the capability
-- that already decides who speaks to the room decides who sees whether
-- the room heard — and it is enforced here in the function, not hidden
-- in the client.
--
-- Members who have left are outside both numbers: a read by somebody
-- who later left says nothing about today's reach, and counting leavers
-- in the denominator would make every old announcement look ignored.

begin;

create function public.announcement_read_stats(p_announcement_id uuid)
returns table (read_count integer, member_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select a.gym_id into v_gym
  from public.gym_announcements a
  where a.id = p_announcement_id;

  if v_gym is null then
    raise exception 'Announcement not found';
  end if;

  if not public.effective_can(v_gym, 'can_post_announcements') then
    raise exception 'Not allowed';
  end if;

  return query
  select
    (select count(*)::integer
       from public.announcement_reads r
       join public.gym_memberships gm
         on gm.profile_id = r.profile_id
        and gm.gym_id = v_gym
        and gm.left_at is null
      where r.announcement_id = p_announcement_id),
    (select count(*)::integer
       from public.gym_memberships gm
      where gm.gym_id = v_gym
        and gm.left_at is null);
end;
$$;

revoke all on function public.announcement_read_stats(uuid) from public, anon;
grant execute on function public.announcement_read_stats(uuid) to authenticated;

commit;
