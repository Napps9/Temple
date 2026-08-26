-- How long a member stays
--
-- Zade & Gareth asked what a new member is actually worth, which starts
-- with how long one lasts. The dates looked like they were already there
-- — gym_memberships.created_at and left_at — and they are not, for two
-- reasons.
--
-- rejoin_gym (0017) clears left_at. Somebody who trained for two years,
-- left, and came back in March reads as a member who joined two years ago
-- and never went anywhere; the leaving is gone, and with it the only
-- completed stay the gym had. Every day this is not recorded is a day of
-- history quietly overwritten, so the episode row is the point of this
-- migration and the number is the easy half.
--
-- And v_member_cohort filters left_at is null, so the one view that
-- describes members cannot see a member who left. Nothing downstream
-- changes here: gym_memberships keeps its columns and rejoin_gym keeps
-- clearing left_at. The episodes sit beside it.
--
-- A TRIGGER, NOT THREE RPCS. A membership row is written by join_gym_by_slug,
-- create_gym, invite acceptance, the CSV and Stripe importers, the agent's
-- enrolment close and rejoin_gym. Hooking the writers means finding all of
-- them today and remembering them forever; the trigger cannot be walked
-- past. 0263 already put a row-level trigger on a member-facing table.
--
-- TWO NUMBERS, NOT A STATISTIC. Averaging only the members who left is the
-- survivorship trap: a gym eight months old that has so far lost only the
-- people who were never going to stay will report a six-week "lifetime"
-- and believe it. So the answer is both halves — what a completed stay
-- looked like, and how long the people still here have been here — and
-- the median rather than the mean, because one member of nine years drags
-- an average nobody recognises. Kaplan-Meier is the right maths and the
-- wrong tile; at gym scale two honest numbers beat a survival curve
-- nobody reads.

begin;

-- ============================================================================
-- 1. The fact
-- ============================================================================

create table public.membership_episodes (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null,
  left_at    timestamptz,
  created_at timestamptz not null default now()
);

create index membership_episodes_gym_profile_idx
  on public.membership_episodes(gym_id, profile_id);

-- One open stay at a time. The trigger relies on this to find the episode
-- a departure closes.
create unique index membership_episodes_one_open_idx
  on public.membership_episodes(gym_id, profile_id)
  where left_at is null;

comment on table public.membership_episodes is
  'One row per stay. gym_memberships holds the current relationship and '
  'rejoin_gym clears its left_at; this holds the history that clearing '
  'would otherwise destroy.';

alter table public.membership_episodes enable row level security;

-- Read for the people who read the numbers; written by the trigger only.
create policy membership_episodes_insights_select on public.membership_episodes
  for select using (public.effective_can(gym_id, 'can_see_insights'));

-- ============================================================================
-- 2. Backfill — one episode per membership that exists today
-- ============================================================================

insert into public.membership_episodes (gym_id, profile_id, joined_at, left_at)
select gm.gym_id, gm.profile_id, gm.created_at, gm.left_at
from public.gym_memberships gm;

-- ============================================================================
-- 3. Keep it true
-- ============================================================================

create or replace function public._membership_episode_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.membership_episodes
      (gym_id, profile_id, joined_at, left_at)
    values (new.gym_id, new.profile_id, new.created_at, new.left_at);
    return new;
  end if;

  -- A departure closes the open stay.
  if new.left_at is not null and old.left_at is null then
    update public.membership_episodes
       set left_at = new.left_at
     where gym_id = new.gym_id
       and profile_id = new.profile_id
       and left_at is null;

  -- A rejoin opens a new one rather than reopening the old: the gap is
  -- the fact worth keeping.
  elsif new.left_at is null and old.left_at is not null then
    insert into public.membership_episodes (gym_id, profile_id, joined_at)
    values (new.gym_id, new.profile_id, now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger membership_episode_sync
  after insert or update of left_at on public.gym_memberships
  for each row execute function public._membership_episode_sync();

-- ============================================================================
-- 4. The number
-- ============================================================================

create function public.compute_member_tenure(p_gym_id uuid)
returns table (
  departed_count         integer,
  median_days_left       integer,
  still_here_count       integer,
  still_here_median_days integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_insights') then
    raise exception 'Not authorised';
  end if;

  return query
  with ep as (
    select e.left_at, e.joined_at
    from public.membership_episodes e
    join public.gym_memberships gm
      on gm.gym_id = e.gym_id and gm.profile_id = e.profile_id
    where e.gym_id = p_gym_id
      and gm.role = 'member'
  ),
  done as (
    select extract(epoch from (left_at - joined_at)) / 86400.0 as days
    from ep where left_at is not null
  ),
  here as (
    select extract(epoch from (now() - joined_at)) / 86400.0 as days
    from ep where left_at is null
  )
  select
    (select count(*)::integer from done),
    (select percentile_cont(0.5) within group (order by days)::integer from done),
    (select count(*)::integer from here),
    (select percentile_cont(0.5) within group (order by days)::integer from here);
end;
$$;

revoke all on function public.compute_member_tenure(uuid) from public, anon;
grant execute on function public.compute_member_tenure(uuid) to authenticated;

commit;
