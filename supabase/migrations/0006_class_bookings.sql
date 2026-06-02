-- Class bookings + member-of-same-gym profile visibility
--
-- class_bookings is the join between a member (profile) and a class
-- session. Capacity is enforced via the book_class SECURITY DEFINER
-- RPC, which row-locks the parent session for the duration of the
-- count-and-insert.
--
-- profiles_gym_member_select lets gym members see one another's
-- names so staff can list class attendees (and so members see the
-- coach's name on a class detail card). The check goes through a
-- SECURITY DEFINER helper to avoid RLS recursion against
-- gym_memberships.

create table public.class_bookings (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  class_session_id  uuid not null references public.class_sessions(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (class_session_id, profile_id)
);

create index class_bookings_session_idx on public.class_bookings(class_session_id);
create index class_bookings_profile_idx on public.class_bookings(profile_id);

alter table public.class_bookings enable row level security;

create policy class_bookings_tenant_select on public.class_bookings
  for select using (public.user_belongs_to(gym_id));

create policy class_bookings_self_or_staff_delete on public.class_bookings
  for delete using (
    profile_id = auth.uid() or public.user_can_manage_classes(gym_id)
  );

-- Insertion goes through book_class only; no policy = denied by default.

create or replace function public.book_class(session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sess           public.class_sessions;
  current_count  int;
  uid            uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the parent session row so concurrent bookings serialise.
  select * into sess
    from public.class_sessions
    where id = session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;
  if not public.user_belongs_to(sess.gym_id) then
    raise exception 'Not authorised';
  end if;
  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  select count(*) into current_count
    from public.class_bookings
    where class_session_id = session_id;

  if current_count >= sess.capacity then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (sess.gym_id, session_id, uid)
  on conflict (class_session_id, profile_id) do nothing;
end;
$$;

grant execute on function public.book_class(uuid) to authenticated;

-- Gym-scoped profile read access (so members can see coach + attendees
-- of classes they share a gym with).
create or replace function public.same_gym_as_caller(target_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.gym_memberships gm1
    join public.gym_memberships gm2 on gm1.gym_id = gm2.gym_id
    where gm1.profile_id = auth.uid()
      and gm2.profile_id = target_profile
      and gm1.status = 'active'
      and gm2.status = 'active'
  );
$$;

grant execute on function public.same_gym_as_caller(uuid) to authenticated;

create policy profiles_gym_member_select on public.profiles
  for select using (public.same_gym_as_caller(id));
