-- Site builder — apply the Team block's hide-list server-side.
--
-- gym_public_team returned the gym's ENTIRE active staff roster to anon and
-- relied on the renderer to drop anyone in the Team block's hiddenMemberIds.
-- That meant a member an owner deliberately hid was still returned by the
-- raw RPC — anyone calling it with the anon key saw the hidden name/avatar.
-- The filter belongs in the RPC, not the renderer.
--
-- Reads the hide-list from published_design (the public snapshot, 0155), so
-- hiding someone takes effect only once re-published — consistent with every
-- other public read. Return shape unchanged. DROP first per the 0043/0098
-- precedent even though the columns are the same, to keep the swap explicit.

begin;

drop function if exists public.gym_public_team(text);

create function public.gym_public_team(p_slug text)
returns table (
  profile_id uuid,
  full_name  text,
  avatar_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select gm.profile_id, p.full_name, p.avatar_url
  from public.gym_memberships gm
  join public.gyms g on g.id = gm.gym_id
  join public.profiles p on p.id = gm.profile_id
  join public.gym_websites w on w.gym_id = g.id
  where g.slug = lower(p_slug)
    and w.published = true
    and gm.role in ('owner', 'admin', 'coach', 'staff')
    and gm.left_at is null
    and gm.profile_id::text not in (
      select hid #>> '{}'
      from jsonb_path_query(
        coalesce(w.published_design, w.design), 'lax $.**.hiddenMemberIds[*]'
      ) as hid
      where jsonb_typeof(hid) = 'string'
    )
  order by
    case gm.role
      when 'owner' then 0
      when 'admin' then 1
      when 'coach' then 2
      else 3
    end,
    p.full_name nulls last;
$$;
grant execute on function public.gym_public_team(text) to anon, authenticated;

commit;
