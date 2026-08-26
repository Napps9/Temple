-- The same three mistakes, everywhere else they were made
--
-- 0266 and 0271 fixed three defects found while building something else.
-- Sweeping for the *shapes* rather than the instances turned up five more
-- and one inconsistency. Where there were three there were eight, which is
-- the argument for sweeping rather than patching.
--
-- The three shapes, as rules:
--
--   A. A number shown to a member must not be counted client-side over a
--      table whose policy hands them a subset.
--   B. A column whose own migration says it is not the displayed value
--      must not be displayed.
--   C. A suppression written in one place must be read by every sender.

begin;

-- ============================================================================
-- A1. The roster a member cannot read
-- ============================================================================
--
-- gym_memberships' tenant select was dropped in 0002 and never re-widened,
-- so a member reads only their own row. Two DM surfaces depend on reading
-- the roster and fail quietly: the recipient picker resolves to one row,
-- the .neq removes it, and the member is told "No matches." — an empty
-- picker on a working feature. Owners and admins see it correctly, which
-- is the same signature as the waitlist count.
--
-- Nothing new is exposed. profiles_gym_member_select (0006) already hands
-- names gym-wide through same_gym_as_caller, and knowing who is a coach is
-- required by dm_scope = 'member_coach_only' — a member cannot obey a rule
-- about coaches without being able to tell who they are. can_dm remains
-- the authority at send; this only decides what the picker can offer.

create or replace function public.gym_directory(p_gym_id uuid)
returns table (
  profile_id uuid,
  full_name  text,
  avatar_url text,
  role       public.gym_role
)
language sql
stable
security definer
set search_path = public
as $$
  select gm.profile_id, p.full_name, p.avatar_url, gm.role
    from public.gym_memberships gm
    join public.profiles p on p.id = gm.profile_id
   where gm.gym_id = p_gym_id
     and gm.left_at is null
     and gm.profile_id <> auth.uid()
     and public.user_belongs_to(p_gym_id)
   order by coalesce(p.full_name, '');
$$;

revoke all on function public.gym_directory(uuid) from public, anon;
grant execute on function public.gym_directory(uuid) to authenticated;

-- ============================================================================
-- A2. The guardian clause class_waitlist never got
-- ============================================================================
--
-- class_bookings gained is_guardian_of in 0266 and its sibling did not.
-- No surface reaches it today — nothing shows a dependent's bookings — so
-- this is consistency rather than a visible fix, and worth saying so. The
-- point is that the next surface does not inherit the asymmetry.

drop policy if exists class_waitlist_self_or_staff_select on public.class_waitlist;

create policy class_waitlist_self_or_staff_select on public.class_waitlist
  for select using (
    profile_id = auth.uid()
    or public.is_guardian_of(profile_id)
    or public.user_can_access_staff_area(gym_id)
  );

-- ============================================================================
-- B1. A rank that is not a rank
-- ============================================================================
--
-- 0016 says it outright: "position is insertion order, NEVER updated. Both
-- leaves and promotions just delete; the visible '#N' is computed at read
-- time." The member's Bookings screen renders the column anyway, so every
-- departure ahead of somebody inflates their number, and once the original
-- first in line leaves, nobody ever reads "You're next in line" — no row
-- has position 1 any more.
--
-- my_waitlist_rank has computed the truth since 0016 and the class modal
-- uses it, so the same member sees two different numbers for one class.
-- The batch form exists because the screen lists several entries at once,
-- which is the same reason class_session_spot_counts is batch.

create or replace function public.my_waitlist_ranks(p_session_ids uuid[])
returns table (
  class_session_id uuid,
  rank             integer
)
language sql
stable
security definer
set search_path = public
as $$
  select r.class_session_id, r.rank::integer
    from (
      select w.class_session_id,
             w.profile_id,
             row_number() over (
               partition by w.class_session_id order by w.position
             ) as rank
        from public.class_waitlist w
       where w.class_session_id = any(p_session_ids)
    ) r
   where r.profile_id = auth.uid();
$$;

revoke all on function public.my_waitlist_ranks(uuid[]) from public, anon;
grant execute on function public.my_waitlist_ranks(uuid[]) to authenticated;

-- ============================================================================
-- C1. The one queue that never read email_suppressions
-- ============================================================================
--
-- Five workers honour it; send-member-messages, the newest, does not. It
-- also re-picks 'failed' rows up to three times, so a hard-bounced address
-- is retried three times per message — precisely the harm _shared/
-- suppression.ts says it exists to turn into one recorded skip.
--
-- The check goes beside the unsubscribe check at enqueue rather than in
-- the worker, because 0271's doctrine is that consent is decided at
-- enqueue. And it is a SEPARATE check, not a widening of the other one:
-- 0229 insists the member's choice and the address being dead are
-- different facts, and a bounce must suppress even a message the member
-- never declined.

create or replace function public._enqueue_member_message(
  p_gym_id            uuid,
  p_profile_id        uuid,
  p_kind              text,
  p_subject           text,
  p_body              text,
  p_key               text,
  p_honour_unsubscribe boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text;
  v_sms_ok   boolean;
  v_email_ok boolean := true;
  v_reason   text;
  v_count    integer;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;

  -- A dead address stops everything, declined or not: there is nobody at
  -- the other end to have an opinion.
  if v_email is not null and exists (
    select 1 from public.email_suppressions es
    where es.gym_id = p_gym_id
      and lower(es.email) = lower(v_email)
  ) then
    v_email_ok := false;
    v_reason := 'Address is suppressed';
  elsif p_honour_unsubscribe and v_email is not null and exists (
    select 1 from public.email_unsubscribes eu
    where eu.gym_id = p_gym_id
      and lower(eu.email) = lower(v_email)
      and eu.topic_id is null
  ) then
    v_email_ok := false;
    v_reason := 'Member unsubscribed from this gym';
  end if;

  -- Everything has to line up: the member asked, we hold a number we can
  -- dial, and the gym's own number can carry a text. Any one missing and
  -- there is no SMS row at all — a skipped row per member per message
  -- would be a table full of the default state.
  select gm.sms_opt_in
     and c.phone_e164 is not null
     and coalesce(s.sms_capable, false)
     and coalesce(s.enabled, false)
    into v_sms_ok
    from public.gym_memberships gm
    left join public.member_contact_details c on c.profile_id = gm.profile_id
    left join public.gym_agent_settings s on s.gym_id = gm.gym_id
   where gm.gym_id = p_gym_id
     and gm.profile_id = p_profile_id
     and gm.left_at is null;

  insert into public.member_outbound_messages
    (gym_id, profile_id, kind, channel, subject, body, status, error,
     idempotency_key)
  select
    p_gym_id, p_profile_id, p_kind, c.channel,
    case when c.channel = 'email' then p_subject end,
    p_body,
    case when c.channel = 'email' and v_email is null then 'skipped'
         when c.channel = 'email' and not v_email_ok then 'skipped'
         else 'queued' end,
    case when c.channel = 'email' and v_email is null
         then 'Member has no email address'
         when c.channel = 'email' and not v_email_ok then v_reason end,
    c.channel || ':' || p_key
  from (
    select 'email' as channel
    union all
    select 'sms' where coalesce(v_sms_ok, false)
  ) c
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public._enqueue_member_message(uuid, uuid, text, text, text, text, boolean)
  from public, anon, authenticated;

-- ============================================================================
-- C2. An unsubscribe read too late to matter
-- ============================================================================
--
-- pending_members.unsubscribed comes straight from the gym's old system on
-- import and is turned into a real email_unsubscribes row only when the
-- member signs up. Between those two moments the fact exists nowhere any
-- sender looks, and two of them mail those people: the join-invite worker,
-- which selects on status alone, and the pending-members campaign
-- audience, whose three suppression filters are all address-keyed and so
-- all pass while no row exists.
--
-- The row is address-keyed and needs no profile, so there was never a
-- reason to wait for one. Writing it at import fixes both readers and any
-- future one at once; the link-time insert stays and simply finds it
-- already there. A trigger rather than restating import_members, which has
-- been redefined in four migrations and has four callers.

create or replace function public._pending_member_unsubscribe_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unsubscribed and new.email is not null then
    insert into public.email_unsubscribes (gym_id, email, reason)
    values (new.gym_id, lower(new.email), 'imported')
    on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  end if;
  return new;
end;
$$;

create trigger pending_member_unsubscribe_sync
  after insert or update of unsubscribed on public.pending_members
  for each row execute function public._pending_member_unsubscribe_sync();

-- Everything already imported, which is the half a trigger cannot reach.
insert into public.email_unsubscribes (gym_id, email, reason)
select pm.gym_id, lower(pm.email), 'imported'
  from public.pending_members pm
 where pm.unsubscribed
   and pm.email is not null
on conflict (gym_id, lower(email)) where topic_id is null do nothing;

-- ============================================================================
-- One refusal, one behaviour
-- ============================================================================
--
-- member_stop_texts skips messages already written for somebody, on the
-- principle that a queued text is a message they have now refused and
-- sending it because it was written first is not listening. Turning the
-- same switch off in the app did not — it cleared the flag and left the
-- queue alone. Two ways of saying no, two answers.

create or replace function public._skip_queued_member_messages(
  p_gym_id     uuid,
  p_profile_id uuid,
  p_channel    text,
  p_reason     text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.member_outbound_messages
     set status = 'skipped', error = p_reason
   where gym_id = p_gym_id
     and profile_id = p_profile_id
     and channel = p_channel
     and status = 'queued';
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public._skip_queued_member_messages(uuid, uuid, text, text)
  from public, anon, authenticated;

-- Restated from 0271 to go through the shared skip, so STOP and the switch
-- cannot drift apart again.
create or replace function public.member_stop_texts(
  p_gym_id uuid,
  p_phone  text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164  text := public._normalise_uk_phone(p_phone);
  v_count integer;
  v_row   record;
begin
  if v_e164 is null then
    return 0;
  end if;

  for v_row in
    select gm.profile_id
      from public.gym_memberships gm
      join public.member_contact_details c on c.profile_id = gm.profile_id
     where c.phone_e164 = v_e164
       and gm.gym_id = p_gym_id
       and gm.left_at is null
  loop
    perform public._skip_queued_member_messages(
      p_gym_id, v_row.profile_id, 'sms', 'Member texted STOP');
  end loop;

  update public.gym_memberships gm
     set sms_opt_in = false
    from public.member_contact_details c
   where c.profile_id = gm.profile_id
     and c.phone_e164 = v_e164
     and gm.gym_id = p_gym_id
     and gm.left_at is null
     and gm.sms_opt_in;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.member_stop_texts(uuid, text) from public, anon, authenticated;

create or replace function public.set_my_sms_opt_in(
  p_gym_id uuid,
  p_value  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update public.gym_memberships
    set sms_opt_in = p_value
    where gym_id = p_gym_id
      and profile_id = v_uid;

  -- Turning it off here is the same refusal as texting STOP.
  if not p_value then
    perform public._skip_queued_member_messages(
      p_gym_id, v_uid, 'sms', 'Member turned texts off');
  end if;
end;
$$;

revoke all on function public.set_my_sms_opt_in(uuid, boolean) from public, anon;
grant execute on function public.set_my_sms_opt_in(uuid, boolean) to authenticated;

create or replace function public.set_my_email_blanket_unsub(
  p_gym_id       uuid,
  p_unsubscribed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then
    raise exception 'No email on account';
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not a member';
  end if;

  if p_unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, topic_id, reason)
    values (p_gym_id, v_email, v_uid, null, 'member blanket')
    on conflict (gym_id, lower(email)) where topic_id is null do nothing;
    -- Same refusal as STOP, in the other channel. Campaign and automation
    -- audiences already re-resolve at send, so this is the queue the
    -- unsubscribe could not otherwise reach.
    perform public._skip_queued_member_messages(
      p_gym_id, v_uid, 'email', 'Member unsubscribed from this gym');
  else
    delete from public.email_unsubscribes
      where gym_id = p_gym_id
        and lower(email) = v_email
        and topic_id is null;
  end if;
end;
$$;

revoke all on function public.set_my_email_blanket_unsub(uuid, boolean) from public, anon;
grant execute on function public.set_my_email_blanket_unsub(uuid, boolean) to authenticated;

commit;
