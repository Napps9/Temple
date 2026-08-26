-- The number you just beat, out loud
--
-- 0263 made a personal best a row and put it in the inbox and the bell.
-- That is the half a member sees if they open the app; the moment the app
-- most has something worth saying is the moment somebody is least likely
-- to be looking at it. So the same sentence now leaves the building by
-- email and, for a member who asked for it, by text.
--
-- ONE SENTENCE, BUILT ONCE. member_milestones.body is deliberately terse
-- ("105 kg - up from 102.5 kg.") because it renders under a "New best -
-- Back Squat" heading. A text arrives cold and has to carry the movement
-- and the gym itself, so the outbound sentence wraps the same numbers
-- rather than recomputing them. A member who reads the text and then opens
-- the app must not be told two slightly different things.
--
-- NOT AN EMAIL AUTOMATION, AND THIS IS THE ONE PLACE THAT ARGUMENT GOES
-- THE OTHER WAY. Every other member email an owner sends is authored by
-- them; a sixth automation trigger anchored on member_milestones would fit
-- the machinery exactly. It is still wrong here, for two reasons. It would
-- double-send against this path rather than replace it, because a
-- milestone would satisfy both. And an owner-authored variant defeats the
-- point above: the whole value of the frozen body is that all three
-- channels say the same thing, and a template with {first_name} in it
-- cannot say what the card says. Custom copy stays a follow-up.
--
-- BUT A BLANKET UNSUBSCRIBE IS HONOURED. 0175 argued the opposite for a
-- failing payment - "a blanket unsubscribe is about campaigns, and a
-- failing payment is not marketing, so suppressing it would be doing the
-- member harm". A personal best is genuinely the other case: nice to hear
-- and entirely declinable. So _enqueue_member_message takes the choice as
-- a parameter rather than deciding for every future sender, and this one
-- passes true.

begin;

-- ============================================================================
-- 1. The channel learns to be declined
-- ============================================================================
--
-- Arity changes, so the drop is required — create or replace cannot add a
-- parameter, and leaving both would make the call ambiguous (0043).

drop function if exists public._enqueue_member_message(uuid, uuid, text, text, text, text);

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
  v_count    integer;
begin
  select u.email into v_email from auth.users u where u.id = p_profile_id;

  -- Whether the member has told this gym to stop emailing them at all.
  -- Keyed on the address, like every other suppression in the product.
  if p_honour_unsubscribe and v_email is not null then
    v_email_ok := not exists (
      select 1 from public.email_unsubscribes eu
      where eu.gym_id = p_gym_id
        and lower(eu.email) = lower(v_email)
        and eu.topic_id is null
    );
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
         when c.channel = 'email' and not v_email_ok
         then 'Member unsubscribed from this gym' end,
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
-- 2. The best itself, now saying so out loud
-- ============================================================================
--
-- Extracted from the live database with pg_get_functiondef and diffed
-- rather than rewritten: this function decides what counts as a personal
-- best at all, and a condition lost here is a member told about a lift
-- they did not beat. The only change is the enqueue after the row lands.

create or replace function public.record_personal_best(
  p_gym_id        uuid,
  p_movement_key  text,
  p_track_key     text,
  p_metric        text,
  p_better        text,
  p_value_numeric numeric  default null,
  p_value_seconds integer  default null,
  p_value_unit    text     default null,
  p_performed_at  timestamptz default now(),
  p_local_day     date     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_value    numeric;
  v_prior    numeric;
  v_beats    boolean;
  v_day      date;
  v_key      text;
  v_body     text;
  v_id       uuid;
  v_shown    text;
  v_prev     text;
  v_sentence text;
  v_gym_name text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- The same two lists strength_leaderboard (0101) validates against.
  if p_metric not in ('weight','time','reps','distance','calories') then
    raise exception 'Unknown metric %', p_metric;
  end if;
  if p_better not in ('higher','lower') then
    raise exception 'Unknown direction %', p_better;
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  v_value := case when p_metric = 'time'
                  then p_value_seconds::numeric
                  else p_value_numeric end;
  if v_value is null then
    return null;
  end if;

  -- The prior best, from what is stored — never from what the client
  -- claims. Both halves of the journal count: a result logged directly
  -- and one tagged inside a workout section are the same lift.
  select case when p_better = 'higher' then max(v) else min(v) end
    into v_prior
  from (
    select case when p_metric = 'time'
                then r.value_seconds::numeric
                else r.value_numeric end as v
      from public.tracked_movement_results r
     where r.profile_id = v_uid
       and r.track_key = p_track_key
       and r.performed_at < p_performed_at
    union all
    select case when p_metric = 'time'
                then e.time_seconds::numeric
                else e.weight_numeric end as v
      from public.tracked_section_movement_tags t
      join public.tracked_workout_sections s on s.id = t.section_id
      join public.tracked_section_entries e on e.section_id = s.id
      join public.tracked_workouts w on w.id = s.workout_id
     where w.profile_id = v_uid
       and t.track_key = p_track_key
       and t.performed_at < p_performed_at
  ) prior
  where v is not null;

  -- A first-ever log is not a personal best. It is the best so far,
  -- which is what the badge means and not what a message would.
  if v_prior is null then
    return null;
  end if;

  v_beats := case when p_better = 'higher'
                  then v_value > v_prior
                  else v_value < v_prior end;
  if not v_beats then
    return null;
  end if;

  v_day := coalesce(p_local_day, (p_performed_at at time zone 'UTC')::date);
  v_key := v_uid::text || ':' || p_track_key || ':' || v_day::text;

  -- FM trims the padding but leaves a trailing point on a whole
  -- number ("100."), which reads as a typo in a sentence.
  v_shown := case when p_metric = 'time'
                  then to_char((p_value_seconds || ' seconds')::interval, 'MI:SS')
                  else rtrim(trim(to_char(v_value, 'FM999999990.99')), '.')
                       || coalesce(' ' || p_value_unit, '') end;
  v_prev := case when p_metric = 'time'
                 then to_char((v_prior::integer || ' seconds')::interval, 'MI:SS')
                 else rtrim(trim(to_char(v_prior, 'FM999999990.99')), '.')
                      || coalesce(' ' || p_value_unit, '') end;
  v_body := v_shown || ' — up from ' || v_prev || '.';

  insert into public.member_milestones
    (gym_id, profile_id, kind, movement_key, track_key,
     value_numeric, value_seconds, previous_numeric, previous_seconds,
     value_unit, body, performed_at, idempotency_key)
  values
    (p_gym_id, v_uid, 'personal_best', p_movement_key, p_track_key,
     p_value_numeric, p_value_seconds,
     case when p_metric = 'time' then null else v_prior end,
     case when p_metric = 'time' then v_prior::integer else null end,
     p_value_unit, v_body, p_performed_at, v_key)
  on conflict (idempotency_key) do update
    set value_numeric    = excluded.value_numeric,
        value_seconds    = excluded.value_seconds,
        previous_numeric = excluded.previous_numeric,
        previous_seconds = excluded.previous_seconds,
        body             = excluded.body,
        performed_at     = excluded.performed_at
  returning id into v_id;

  -- The other two channels. The sentence is built once from the same
  -- numbers the card shows, so a member who reads the text and then opens
  -- the app is not told two slightly different things. The card can be
  -- terse because it sits under a "New best - Back Squat" heading; a text
  -- arriving cold has to carry the movement and the gym itself.
  select name into v_gym_name from public.gyms where id = p_gym_id;
  v_sentence := coalesce(v_gym_name, 'Your gym') || ': new best on '
    || initcap(replace(p_movement_key, '_', ' ')) || ' - ' || v_body;

  perform public._enqueue_member_message(
    p_gym_id, v_uid, 'personal_best',
    'A new best at ' || coalesce(v_gym_name, 'your gym'),
    v_sentence,
    'milestone:' || v_key,
    true
  );

  return v_id;
end;
$$;

revoke all on function public.record_personal_best(
  uuid, text, text, text, text, numeric, integer, text, timestamptz, date)
  from public, anon;
grant execute on function public.record_personal_best(
  uuid, text, text, text, text, numeric, integer, text, timestamptz, date)
  to authenticated;

commit;
