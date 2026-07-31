-- The conversation survives a refresh
--
-- The bar's memory has been real but weightless: turns lived in React
-- state, so a reload emptied it. A card left open vanished, "what did I
-- ask yesterday" had no answer, and the Timeline — a surface whose whole
-- pitch is being the place the gym's life shows up — had no past.
--
-- This is the store. Deliberately small: who said it, what they said,
-- when, and which member it was about if any. No card payloads, no
-- previews, no action arguments — a preview is a snapshot of a gym that
-- has since moved, and replaying one would be showing somebody a
-- confirmation for a world that no longer exists.
--
-- Three things about privacy, because this is the first table in Temple
-- that records what staff asked rather than what they did.
--
--  1. You read your own. Not the gym's. An owner reading back every
--     question a coach ever asked about a member is a surveillance
--     feature nobody asked for, and the ask here was "what did I ask
--     yesterday" — first person, both times.
--
--  2. Ninety days, then gone. The owner's call, and the same shape as
--     purge_expired_leads (0114) so it is one more entry on a cron that
--     already runs rather than a new mechanism.
--
--  3. Forgetting a member forgets the conversation about them.
--     _erase_member_health_data is the gym's forget-this-member path —
--     leave_gym calls it, the self-serve withdraw button calls it, the
--     retention sweep calls it. Chat turns are not health data and this
--     is not a health obligation, but a stored sentence naming somebody
--     is exactly what "forget them" has to include, and that function is
--     where every caller already looks.
--
-- What this does NOT do, on purpose: write to health_data_access_log.
-- That log is a GDPR Article 9 trail, written when somebody with
-- can_see_health_flag opens a surface that shows health data. The bar's
-- member card carries none by design, so logging an access there would
-- put a false Article 9 entry in an audit whose value is being exactly
-- true. The chat is not a way around that log because it is not a way to
-- the data.

-- ---------------------------------------------------------------------------
-- 1. The store
-- ---------------------------------------------------------------------------

create table public.chat_turns (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  -- Who was talking to the bar. Not "created_by" — this is whose
  -- conversation it is, and it is the whole of the read policy.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'gym')),
  text       text not null check (char_length(text) between 1 and 4000),
  -- The member the turn was about, when one was resolved. Nullable
  -- because most turns are about the gym. This is what makes erasure
  -- possible without reading the text.
  subject_profile_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The read is always "my turns at this gym, newest first", so the index
-- is that query and not a general one.
create index chat_turns_mine_idx
  on public.chat_turns (gym_id, profile_id, created_at desc);

-- Erasure deletes by subject, which is a different access path.
create index chat_turns_subject_idx
  on public.chat_turns (subject_profile_id)
  where subject_profile_id is not null;

alter table public.chat_turns enable row level security;

create policy chat_turns_own_select on public.chat_turns
  for select using (
    profile_id = auth.uid()
    and public.effective_can(gym_id, 'can_access_staff_area')
  );

create policy chat_turns_own_insert on public.chat_turns
  for insert with check (
    profile_id = auth.uid()
    and public.effective_can(gym_id, 'can_access_staff_area')
  );

-- Deleting your own history is a reasonable thing to want and costs
-- nothing to allow. There is no UPDATE: a turn is a record of something
-- that was said, and editing it would make the record a draft.
create policy chat_turns_own_delete on public.chat_turns
  for delete using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Ninety days
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_chat_turns()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.chat_turns
      where created_at < now() - interval '90 days'
      returning id
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

revoke execute on function public.purge_expired_chat_turns()
  from public, anon, authenticated;

-- 03:20 UTC, between the lead purge and the health sweep, on a day
-- boundary where nobody is mid-sentence.
select cron.schedule(
  'purge-expired-chat-turns',
  '20 3 * * *',
  $$select public.purge_expired_chat_turns();$$
);

-- ---------------------------------------------------------------------------
-- 3. Forgetting a member forgets the conversation about them
-- ---------------------------------------------------------------------------
--
-- 0037's function, restated with one statement added. Everything else is
-- exactly as it was — this is the path leave_gym, the self-serve withdraw
-- and purge_expired_health_data all call, so a change here reaches all
-- three without any of them knowing about chat.

create or replace function public._erase_member_health_data(
  p_gym_id  uuid,
  p_profile uuid,
  p_action  text default 'erase'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- parq_answers cascade from parq_responses; injury_updates cascade
  -- from member_injuries.
  delete from public.parq_responses
    where gym_id = p_gym_id and profile_id = p_profile;

  delete from public.member_injuries
    where gym_id = p_gym_id and profile_id = p_profile;

  delete from public.staff_alerts
    where gym_id = p_gym_id
      and subject_profile_id = p_profile
      and kind in ('parq_flag', 'injury_new', 'injury_update');

  delete from public.member_consents
    where gym_id = p_gym_id and profile_id = p_profile;

  -- Not health data, and not a health obligation. A stored sentence
  -- naming somebody is still a record of them, and this is the function
  -- every "forget this member" path already goes through.
  delete from public.chat_turns
    where gym_id = p_gym_id and subject_profile_id = p_profile;

  -- Clear the denormalised health columns on the membership.
  update public.gym_memberships
    set health_flag = false,
        par_q_id = null,
        emergency_contact = null
    where gym_id = p_gym_id and profile_id = p_profile;

  insert into public.health_data_access_log
    (gym_id, actor_id, subject_profile_id, action, surface)
    values (p_gym_id, auth.uid(), p_profile,
            case when p_action = 'purge' then 'purge' else 'erase' end,
            'erase_member_health_data');
end;
$$;
