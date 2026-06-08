-- Three messaging surfaces, one migration:
--
--   1. Direct messages — 1:1 between any two profiles in a gym.
--      Visibility scoped to the two participants. Send policy gated
--      on gyms.dm_scope:
--        full_gym         — anyone can DM anyone (default)
--        member_coach_only — members can only DM staff; staff can DM
--                             anyone.
--      Owner flips the scope via set_dm_scope.
--
--   2. Gym announcements — 1:N broadcast to all gym members. Posted
--      by anyone with can_post_announcements (default-on for owner,
--      admin, coach). Read tracked per-member via
--      announcement_reads.
--
--   3. Class session broadcasts — 1:N broadcast scoped to the
--      bookings of a single class_session. Posted by anyone with
--      can_broadcast_to_class (default-on for owner, admin, coach).
--      "Coach is running late" / "bring a jump rope" / etc. Read
--      tracked per-member via class_session_broadcast_reads.
--
-- All three surfaces share the same dm_inbox / announcement /
-- broadcast row pattern: insert is gated, select is participant- or
-- gym-bound, and per-member "read_at" is tracked separately so a
-- single broadcast can be marked-as-seen by N different people
-- without writing the row.

begin;

-- ============================================================================
-- 1. gyms.dm_scope
-- ============================================================================

alter table public.gyms
  add column if not exists dm_scope text not null default 'full_gym'
    check (dm_scope in ('full_gym', 'member_coach_only'));

-- ============================================================================
-- 2. Register capabilities + helper
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
    else false
  end;
$$;

-- can_dm(gym, sender, recipient) — server-side check for the DM
-- scope policy. Both parties must belong to the gym; member↔member
-- is blocked when the scope is member_coach_only.
create or replace function public.can_dm(
  p_gym_id    uuid,
  p_sender    uuid,
  p_recipient uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_sender_role public.gym_role;
  v_recipient_role public.gym_role;
begin
  if p_sender = p_recipient then return false; end if;
  select g.dm_scope into v_scope from public.gyms g where g.id = p_gym_id;
  if v_scope is null then return false; end if;

  select gm.role into v_sender_role
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_sender
      and gm.left_at is null;
  select gm.role into v_recipient_role
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_recipient
      and gm.left_at is null;
  if v_sender_role is null or v_recipient_role is null then return false; end if;

  if v_scope = 'full_gym' then return true; end if;
  -- member_coach_only: staff can DM anyone; members only DM staff.
  if v_sender_role in ('owner','admin','coach') then return true; end if;
  return v_recipient_role in ('owner','admin','coach');
end;
$$;

grant execute on function public.can_dm(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- 3. direct_messages
-- ============================================================================

create table public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (length(body) > 0),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index direct_messages_recipient_created_idx
  on public.direct_messages (recipient_id, created_at desc);
create index direct_messages_sender_created_idx
  on public.direct_messages (sender_id, created_at desc);
create index direct_messages_pair_idx
  on public.direct_messages
     (gym_id, least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);

alter table public.direct_messages enable row level security;

create policy direct_messages_participants_select on public.direct_messages
  for select using (
    sender_id = auth.uid() or recipient_id = auth.uid()
  );

create policy direct_messages_sender_insert on public.direct_messages
  for insert with check (
    sender_id = auth.uid()
    and public.can_dm(gym_id, sender_id, recipient_id)
  );

-- Recipient can flip read_at to mark a message seen.
create policy direct_messages_recipient_update on public.direct_messages
  for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Sender can delete their own messages (no edit; just delete).
create policy direct_messages_sender_delete on public.direct_messages
  for delete using (sender_id = auth.uid());

-- ============================================================================
-- 4. gym_announcements + reads
-- ============================================================================

create table public.gym_announcements (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  posted_by  uuid references public.profiles(id) on delete set null,
  title      text not null check (length(title) > 0),
  body       text not null check (length(body) > 0),
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

create index gym_announcements_gym_created_idx
  on public.gym_announcements (gym_id, pinned desc, created_at desc);

alter table public.gym_announcements enable row level security;

create policy gym_announcements_member_select on public.gym_announcements
  for select using (public.user_belongs_to(gym_id));

create policy gym_announcements_staff_insert on public.gym_announcements
  for insert with check (
    posted_by = auth.uid()
    and public.effective_can(gym_id, 'can_post_announcements')
  );

create policy gym_announcements_author_or_staff_update on public.gym_announcements
  for update
  using (
    posted_by = auth.uid()
    or public.effective_can(gym_id, 'can_post_announcements')
  )
  with check (
    posted_by = auth.uid()
    or public.effective_can(gym_id, 'can_post_announcements')
  );

create policy gym_announcements_author_or_owner_delete on public.gym_announcements
  for delete using (
    posted_by = auth.uid()
    or public.user_is_owner_of(gym_id)
  );

create table public.announcement_reads (
  announcement_id uuid not null references public.gym_announcements(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.announcement_reads enable row level security;

create policy announcement_reads_self_select on public.announcement_reads
  for select using (profile_id = auth.uid());

create policy announcement_reads_self_insert on public.announcement_reads
  for insert with check (profile_id = auth.uid());

create policy announcement_reads_self_delete on public.announcement_reads
  for delete using (profile_id = auth.uid());

-- ============================================================================
-- 5. class_session_broadcasts + reads
-- ============================================================================

create table public.class_session_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  class_session_id uuid not null references public.class_sessions(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  body             text not null check (length(body) > 0),
  created_at       timestamptz not null default now()
);

create index class_session_broadcasts_session_idx
  on public.class_session_broadcasts (class_session_id, created_at desc);
create index class_session_broadcasts_gym_idx
  on public.class_session_broadcasts (gym_id, created_at desc);

alter table public.class_session_broadcasts enable row level security;

create policy class_session_broadcasts_visible_select on public.class_session_broadcasts
  for select using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.class_bookings b
      where b.class_session_id = class_session_broadcasts.class_session_id
        and b.profile_id = auth.uid()
    )
    or public.effective_can(gym_id, 'can_broadcast_to_class')
  );

create policy class_session_broadcasts_staff_insert on public.class_session_broadcasts
  for insert with check (
    sender_id = auth.uid()
    and public.effective_can(gym_id, 'can_broadcast_to_class')
  );

create policy class_session_broadcasts_author_delete on public.class_session_broadcasts
  for delete using (sender_id = auth.uid());

create table public.class_session_broadcast_reads (
  broadcast_id uuid not null references public.class_session_broadcasts(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (broadcast_id, profile_id)
);

alter table public.class_session_broadcast_reads enable row level security;

create policy class_session_broadcast_reads_self_select on public.class_session_broadcast_reads
  for select using (profile_id = auth.uid());
create policy class_session_broadcast_reads_self_insert on public.class_session_broadcast_reads
  for insert with check (profile_id = auth.uid());
create policy class_session_broadcast_reads_self_delete on public.class_session_broadcast_reads
  for delete using (profile_id = auth.uid());

-- ============================================================================
-- 6. RPCs
-- ============================================================================

create or replace function public.set_dm_scope(p_gym_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_scope not in ('full_gym', 'member_coach_only') then
    raise exception 'Unknown DM scope: %', p_scope;
  end if;
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  update public.gyms set dm_scope = p_scope where id = p_gym_id;
end;
$$;
grant execute on function public.set_dm_scope(uuid, text) to authenticated;

-- Aggregate a member's DM inbox: one row per peer (the *other* side
-- of every conversation they're in), with the last message + unread
-- count. Used to render the inbox list cheaply.
create or replace function public.dm_inbox()
returns table (
  peer_profile_id        uuid,
  peer_full_name         text,
  peer_role              public.gym_role,
  last_message_id        uuid,
  last_message_body      text,
  last_message_at        timestamptz,
  last_message_from_me   boolean,
  unread_count           integer
)
language sql
security definer
stable
set search_path = public
as $$
  with my_messages as (
    select dm.*
    from public.direct_messages dm
    where dm.sender_id = auth.uid() or dm.recipient_id = auth.uid()
  ),
  paired as (
    select
      m.gym_id,
      case when m.sender_id = auth.uid() then m.recipient_id else m.sender_id end as peer_profile_id,
      m.id, m.body, m.created_at, m.read_at,
      m.sender_id = auth.uid() as from_me,
      m.recipient_id = auth.uid() as to_me
    from my_messages m
  ),
  ranked as (
    select distinct on (p.peer_profile_id)
      p.peer_profile_id, p.gym_id,
      p.id as last_message_id, p.body as last_message_body,
      p.created_at as last_message_at, p.from_me as last_message_from_me
    from paired p
    order by p.peer_profile_id, p.created_at desc
  ),
  unread as (
    select p.peer_profile_id, count(*)::int as unread_count
    from paired p
    where p.to_me and p.read_at is null
    group by p.peer_profile_id
  )
  select
    r.peer_profile_id,
    coalesce(pr.full_name, 'Member') as peer_full_name,
    gm.role as peer_role,
    r.last_message_id, r.last_message_body, r.last_message_at, r.last_message_from_me,
    coalesce(u.unread_count, 0) as unread_count
  from ranked r
  left join public.profiles pr on pr.id = r.peer_profile_id
  left join public.gym_memberships gm
    on gm.gym_id = r.gym_id and gm.profile_id = r.peer_profile_id and gm.left_at is null
  left join unread u on u.peer_profile_id = r.peer_profile_id
  order by r.last_message_at desc;
$$;
grant execute on function public.dm_inbox() to authenticated;

create or replace function public.mark_dm_thread_read(p_peer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.direct_messages
    set read_at = now()
    where recipient_id = auth.uid()
      and sender_id = p_peer_id
      and read_at is null;
end;
$$;
grant execute on function public.mark_dm_thread_read(uuid) to authenticated;

-- Member-facing total unread across DMs + announcements + class
-- broadcasts. Returns one row with three counts for the nav badge.
create or replace function public.inbox_unread_summary()
returns table (
  dm_unread              integer,
  announcement_unread    integer,
  class_broadcast_unread integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      select count(*)::int from public.direct_messages
      where recipient_id = auth.uid() and read_at is null
    ),
    (
      select count(*)::int from public.gym_announcements a
      where exists (
        select 1 from public.gym_memberships gm
        where gm.gym_id = a.gym_id
          and gm.profile_id = auth.uid()
          and gm.left_at is null
      )
      and not exists (
        select 1 from public.announcement_reads r
        where r.announcement_id = a.id and r.profile_id = auth.uid()
      )
    ),
    (
      select count(*)::int from public.class_session_broadcasts cb
      where exists (
        select 1 from public.class_bookings b
        where b.class_session_id = cb.class_session_id
          and b.profile_id = auth.uid()
      )
      and not exists (
        select 1 from public.class_session_broadcast_reads r
        where r.broadcast_id = cb.id and r.profile_id = auth.uid()
      )
    );
$$;
grant execute on function public.inbox_unread_summary() to authenticated;

commit;
