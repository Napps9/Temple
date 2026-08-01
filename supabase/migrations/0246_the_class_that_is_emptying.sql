-- The class that is emptying
--
-- The seventh job, and the first that is not about one person.
--
-- Five questions in the bar draw their numbers already — what the gym
-- took, how busy it has been, who has gone quiet, what the shop sold,
-- where the leads are. All five are PULL: the owner has to think to ask.
-- The roadmap's second measure is owner interventions per member per
-- month, and a question nobody asks moves it by nothing. So this job is
-- the push half, and the roadmap's own words for what push looks like:
-- every chart ends in a verb.
--
-- WHAT IT NOTICES. A recurring slot — a class type on a weekday at a
-- local time, which is what an owner means by "the Tuesday 6am" — whose
-- attendance has fallen against its own recent history. Not the gym's
-- attendance, which is retention's territory in aggregate and nobody's
-- decision in particular; one slot, which is a thing you can do something
-- about.
--
-- WHAT IT PROPOSES. A message to the people who used to come to that
-- slot and have stopped, and who are STILL TRAINING AT THE GYM. That last
-- clause is the whole design. Somebody who stopped coming altogether is
-- retention's job and gets retention's message; somebody who trains three
-- times a week and has quietly abandoned one class is invisible to every
-- job in the product, because every existing predicate is satisfied by
-- them attending anything. The two jobs are disjoint by construction and
-- their messages are honest as a result: "we have missed you" from one,
-- "we have missed you at the Tuesday 6am" from this one.
--
-- WHY THE THRESHOLDS ARE WHERE THEY ARE. A slot with four people is
-- noise: two of them going on holiday the same fortnight is a 50% drop
-- and not a fact about the class. So the earlier window has to average at
-- least four a session before this looks at all, and the fall has to be
-- at least 40% AND at least two a session — both, so that a small class
-- has to really empty and a big one cannot hide a real collapse behind a
-- flattering percentage. Three sessions in each window, or it is a new
-- slot or a cancelled run rather than a decline. Three recipients, or it
-- is two people's schedules changing.
--
-- THE FAN-OUT, WHICH IS NEW. Every other job's approval sends one email
-- to one person. This one sends up to twelve from a single tap, so it
-- takes the strictest budget in the framework: one slot per gym per day
-- against the other jobs' three, once per slot per 90 days, and a hard
-- cap of twelve recipients — past that it is a mailshot, not a nudge, and
-- the card says how many were left out rather than quietly dropping them.
-- It shares the gym's daily ask budget like the other four noticing jobs.
--
-- WHAT IT NEVER DOES. Never cancels or moves the class — an emptying
-- slot might need a different coach, a different time or nothing at all,
-- and that is the owner's call with more context than Temple has. Never
-- suggests dropping it. Never tells anyone but the member themselves
-- anything about their own attendance.

begin;

-- ---------------------------------------------------------------------------
-- 1. Widen the framework's kind vocabularies
-- ---------------------------------------------------------------------------

alter table public.agent_actions
  drop constraint agent_actions_action_kind_check;
alter table public.agent_actions
  add constraint agent_actions_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer', 'class_return_message'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message', 'credits_low_message',
     'plan_upgrade_offer', 'class_return_message'));

-- cover_ask is still the only kind absent here: it re-asks through the
-- cover plumbing and never mails a member, so it has no template.
alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'first_week_message', 'credits_low_message', 'plan_upgrade_offer',
     'class_return_message'));

-- ---------------------------------------------------------------------------
-- 2. Switching the job on and off
-- ---------------------------------------------------------------------------

create or replace function public.set_class_return_job(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only the owner can change this';
  end if;

  if p_enabled then
    insert into public.agent_authority (gym_id, action_kind, level, updated_by)
    values (p_gym_id, 'class_return_message', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'class_return_message',
       'Hi {first_name} — it''s {gym_name}. We haven''t seen you at '
       || '{class_name} for a few weeks and wanted to say the spot''s '
       || 'still there if you fancy it. If the time has stopped working, '
       || 'reply and tell us — we''d rather know.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'class_return_message';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'class_return_message'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_class_return_job(uuid, boolean) from public, anon;
grant execute on function public.set_class_return_job(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The budget takes in the seventh
-- ---------------------------------------------------------------------------
--
-- 0242's four capped kinds become five. Same argument: this is the gym
-- noticing something, and a day later is the same message.

create or replace function public._agent_ask_budget_left(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 5 - (
    select count(*)::int
      from public.agent_actions
     where gym_id = p_gym_id
       and action_kind in ('retention_message', 'first_week_message',
                           'credits_low_message', 'plan_upgrade_offer',
                           'class_return_message')
       and proposed_at > now() - interval '1 day'
  ));
$$;

revoke all on function public._agent_ask_budget_left(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The executor learns to send to more than one person
-- ---------------------------------------------------------------------------
--
-- Restated from 0241 with one branch added, extracted verbatim and
-- diffed rather than rewritten from memory: this is the one path by which
-- any job's approved action reaches a member, and a branch lost here is a
-- job that silently sends nothing.
--
-- The new branch is the first fan-out. Every kind above it queues one row
-- keyed 'agent-action:<id>'; this one queues a row per recipient keyed
-- 'agent-action:<id>:<profile>', so a re-execute is still idempotent per
-- person and a partially-sent action cannot double-mail anybody.

create or replace function public._agent_execute_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a         record;
  t         record;
  v_gym     record;
  v_first   text;
  v_body    text;
  v_subject text;
  r         jsonb;
begin
  select * into a from public.agent_actions where id = p_action_id;
  if a is null or a.status <> 'approved' then
    raise exception 'Action is not approved';
  end if;

  if a.action_kind = 'cover_ask' then
    perform public._agent_cover_reask((a.payload->>'request_id')::uuid);
    update public.agent_actions
      set status = 'executed', executed_at = now()
      where id = a.id;
    return;
  end if;

  select body into t
    from public.agent_message_templates
    where gym_id = a.gym_id and kind = a.action_kind;
  if t is null then
    raise exception 'No approved template';
  end if;

  select name into v_gym from public.gyms where id = a.gym_id;

  if a.action_kind = 'class_return_message' then
    v_subject := 'The ' || coalesce(a.payload->>'class_label', 'class')
      || ' at ' || coalesce(v_gym.name, 'the gym');
    for r in
      select value from jsonb_array_elements(coalesce(a.payload->'recipients', '[]'::jsonb))
    loop
      v_body := replace(t.body, '{first_name}',
        split_part(coalesce(r->>'name', 'there'), ' ', 1));
      v_body := replace(v_body, '{gym_name}', coalesce(v_gym.name, 'your gym'));
      v_body := replace(v_body, '{class_name}',
        coalesce(a.payload->>'class_label', 'your usual class'));
      insert into public.agent_outbound_messages
        (gym_id, case_id, action_id, recipient_profile_id, subject, body,
         idempotency_key)
      values
        (a.gym_id, a.case_id, a.id, (r->>'profile_id')::uuid, v_subject, v_body,
         'agent-action:' || a.id || ':' || (r->>'profile_id'))
      on conflict (idempotency_key) do nothing;
    end loop;
    update public.agent_actions
      set status = 'executed', executed_at = now()
      where id = a.id;
    return;
  end if;

  v_first := split_part(coalesce(a.payload->>'member_name', 'there'), ' ', 1);

  v_body := replace(t.body, '{first_name}', v_first);
  v_body := replace(v_body, '{gym_name}', coalesce(v_gym.name, 'your gym'));
  v_body := replace(v_body, '{plan_name}',
    coalesce(a.payload->>'plan_name', 'membership'));
  v_body := replace(v_body, '{offer_plan}',
    coalesce(a.payload->>'offer_plan_name', 'a smaller plan'));
  v_body := replace(v_body, '{offer_price}',
    coalesce(a.payload->>'offer_price', ''));
  -- Written out in the tick as "1 class" or "2 classes", so the template
  -- never has to do arithmetic or guess at a plural.
  v_body := replace(v_body, '{credits_left}',
    coalesce(a.payload->>'credits_left_phrase', 'a couple of classes'));
  -- Likewise already formatted in the gym's currency by the tick.
  v_body := replace(v_body, '{upgrade_saving}',
    coalesce(a.payload->>'upgrade_saving', 'a bit'));

  v_subject := case a.action_kind
    when 'plan_adjustment_offer'
      then 'A thought about your ' || coalesce(v_gym.name, 'gym') || ' membership'
    when 'retention_message'
      then 'We''ve missed you at ' || coalesce(v_gym.name, 'the gym')
    when 'first_week_message'
      then 'Getting you started at ' || coalesce(v_gym.name, 'the gym')
    when 'credits_low_message'
      then 'Running low on classes at ' || coalesce(v_gym.name, 'the gym')
    when 'plan_upgrade_offer'
      then 'A cheaper way to train at ' || coalesce(v_gym.name, 'the gym')
    else 'About your ' || coalesce(v_gym.name, 'gym') || ' membership payment'
  end;

  insert into public.agent_outbound_messages
    (gym_id, case_id, action_id, recipient_profile_id, subject, body,
     idempotency_key)
  values
    (a.gym_id, a.case_id, a.id, a.subject_profile, v_subject, v_body,
     'agent-action:' || a.id)
  on conflict (idempotency_key) do nothing;

  update public.agent_actions
    set status = 'executed', executed_at = now()
    where id = a.id;

  update public.agent_cases
    set stage = case when a.action_kind = 'plan_adjustment_offer'
                     then 'offer_pending' else 'touch_2_sent' end
    where id = a.case_id and stage <> 'closed';
end;
$$;

revoke all on function public._agent_execute_action(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Saying a slot out loud
-- ---------------------------------------------------------------------------
--
-- "Tuesday 6am CrossFit", not "CrossFit @ 06:00 (dow 2)". The owner reads
-- this on the card and the member reads it in the message, so it is built
-- once, here, and both take it from the payload.

create or replace function public._slot_label(
  p_dow int, p_at time, p_class text
) returns text
language sql
immutable
as $$
  select trim(to_char(date '2024-01-07' + p_dow, 'FMDay'))
    || ' '
    || case when extract(minute from p_at) = 0
            then trim(to_char(p_at, 'FMHH12')) || lower(to_char(p_at, 'AM'))
            else trim(to_char(p_at, 'FMHH12:MI')) || lower(to_char(p_at, 'AM'))
       end
    || ' ' || p_class;
$$;

-- ---------------------------------------------------------------------------
-- 6. The tick — daily
-- ---------------------------------------------------------------------------

create or replace function public.agent_class_return_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s          record;
  v_started  timestamptz := clock_timestamp();
  v_action   uuid;
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_level    text;
  v_recips   jsonb;
  v_eligible integer;
  v_label    text;
  v_tz       text;
  v_was      numeric;
  v_now      numeric;
begin
  for s in
    with sess as (
      select cs.gym_id,
             cs.id,
             cs.class_type_id,
             ct.name as class_name,
             extract(dow from (cs.starts_at at time zone g.timezone))::int as dow,
             (cs.starts_at at time zone g.timezone)::time as at_time,
             (cs.starts_at > now() - interval '28 days') as recent
        from public.class_sessions cs
        join public.gyms g on g.id = cs.gym_id
        join public.class_types ct on ct.id = cs.class_type_id
        join public.agent_authority a
          on a.gym_id = cs.gym_id
         and a.action_kind = 'class_return_message'
         and a.level <> 'reserved'
       where cs.starts_at > now() - interval '56 days'
         and cs.starts_at < now()
         and ct.archived_at is null
    ),
    slot as (
      select sess.gym_id, sess.class_type_id, sess.class_name,
             sess.dow, sess.at_time,
             count(*) filter (where sess.recent)::int     as sess_recent,
             count(*) filter (where not sess.recent)::int as sess_before,
             coalesce(sum(case when sess.recent then att.n end), 0)::int as att_recent,
             coalesce(sum(case when not sess.recent then att.n end), 0)::int as att_before
        from sess
        join lateral (
          select count(*)::int as n
            from public.class_bookings cb
           where cb.class_session_id = sess.id
             and cb.attended_at is not null
        ) att on true
       group by 1, 2, 3, 4, 5
    )
    select slot.*,
           slot.att_before::numeric / slot.sess_before as was,
           slot.att_recent::numeric / slot.sess_recent as is_now
      from slot
     -- Rule: three sessions each side, or this is a new slot or a
     -- cancelled run rather than a decline.
     where slot.sess_recent >= 3
       and slot.sess_before >= 3
       -- Rule: below four a session there is no signal, only noise.
       and slot.att_before::numeric / slot.sess_before >= 4
       -- Rule: down 40% AND down two a session. Both, so a small class
       -- has to really empty and a big one cannot hide a collapse behind
       -- a flattering percentage.
       and (slot.att_before::numeric / slot.sess_before)
           - (slot.att_recent::numeric / slot.sess_recent)
           >= greatest(2::numeric,
                       0.4 * (slot.att_before::numeric / slot.sess_before))
       -- Rule: once per slot per 90 days. A class does not need chasing
       -- monthly, and a rejection is final for that quarter.
       and not exists (
         select 1 from public.agent_actions aa
          where aa.gym_id = slot.gym_id
            and aa.action_kind = 'class_return_message'
            and aa.payload->>'class_type_id' = slot.class_type_id::text
            and (aa.payload->>'dow')::int = slot.dow
            and aa.payload->>'at_time' = slot.at_time::text
            and aa.proposed_at > now() - interval '90 days')
     order by slot.gym_id,
              (slot.att_before::numeric / slot.sess_before)
              - (slot.att_recent::numeric / slot.sess_recent) desc,
              slot.class_type_id, slot.dow, slot.at_time
  loop
    -- Rule: one slot per gym per day. Every other job takes three,
    -- because every other job's approval sends one email.
    if (select count(*) from public.agent_actions
         where gym_id = s.gym_id and action_kind = 'class_return_message'
           and proposed_at > now() - interval '1 day') >= 1 then
      continue;
    end if;

    if public._agent_ask_budget_left(s.gym_id) <= 0 then
      perform public._agent_record_deferral(s.gym_id);
      continue;
    end if;

    select timezone into v_tz from public.gyms where id = s.gym_id;

    -- Who used to come and has stopped — but is STILL TRAINING HERE.
    -- Somebody who has stopped altogether belongs to retention, and
    -- being in both jobs' sights is how one person gets two messages
    -- about the same silence.
    --
    -- One statement for the count and the list. Written as two it was
    -- the same forty-line predicate twice, which is the state a rule is
    -- in just before its halves stop agreeing — and a card saying "9
    -- people" while 7 get the message is a lie the owner cannot see.
    with cand as (
      select gm.profile_id, p.full_name,
             (select count(*) from public.class_bookings cb
                join public.class_sessions cs2 on cs2.id = cb.class_session_id
               where cb.profile_id = gm.profile_id
                 and cb.gym_id = s.gym_id
                 and cb.attended_at is not null
                 and cs2.class_type_id = s.class_type_id
                 and extract(dow from (cs2.starts_at at time zone v_tz))::int = s.dow
                 and (cs2.starts_at at time zone v_tz)::time = s.at_time
                 and cs2.starts_at between now() - interval '56 days'
                                       and now() - interval '28 days') as came
        from public.gym_memberships gm
        join public.profiles p on p.id = gm.profile_id
       where gm.gym_id = s.gym_id
         and gm.role = 'member'
         and gm.left_at is null
         and not exists (
           select 1 from public.class_bookings cb
             join public.class_sessions cs3 on cs3.id = cb.class_session_id
            where cb.profile_id = gm.profile_id
              and cb.gym_id = s.gym_id
              and cb.attended_at is not null
              and cs3.class_type_id = s.class_type_id
              and extract(dow from (cs3.starts_at at time zone v_tz))::int = s.dow
              and (cs3.starts_at at time zone v_tz)::time = s.at_time
              and cs3.starts_at > now() - interval '28 days')
         -- Still training here, which is what makes this job's message
         -- true and keeps it out of retention's way.
         and exists (
           select 1 from public.class_bookings cb
            where cb.gym_id = s.gym_id and cb.profile_id = gm.profile_id
              and cb.attended_at > now() - interval '30 days')
    ),
    elig as (select * from cand where came >= 2),
    -- Rule: twelve at most. Past that it is a mailshot rather than a
    -- nudge — the most regular twelve get it and the card says who was
    -- left out rather than the number quietly disappearing.
    top as (select * from elig order by came desc, full_name asc limit 12)
    select (select count(*)::int from elig),
           (select jsonb_agg(jsonb_build_object(
                     'profile_id', profile_id::text,
                     'name', coalesce(full_name, 'there'))
                   order by came desc, full_name asc)
              from top)
      into v_eligible, v_recips;

    -- Rule: fewer than three is two people's schedules changing.
    if v_eligible < 3 then
      continue;
    end if;

    v_label := public._slot_label(s.dow, s.at_time, s.class_name);
    v_was   := round(s.was, 1);
    v_now   := round(s.is_now, 1);

    select level into v_level from public.agent_authority
      where gym_id = s.gym_id and action_kind = 'class_return_message';

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (s.gym_id, 'retention', 'class_return_message', null,
       jsonb_build_object(
         'class_type_id', s.class_type_id::text,
         'class_name', s.class_name,
         'dow', s.dow,
         'at_time', s.at_time::text,
         'class_label', v_label,
         'was_average', v_was,
         'now_average', v_now,
         'eligible', v_eligible,
         'recipients', coalesce(v_recips, '[]'::jsonb)
       ),
       jsonb_build_array(
         v_label || ' averaged ' || v_was || ' a class over the four weeks '
           || 'to a month ago, and ' || v_now || ' since.',
         v_eligible || ' ' || case when v_eligible = 1 then 'person' else 'people' end
           || ' who used to come regularly have stopped, and all of them are '
           || 'still training here — so this is about the class, not about them '
           || 'drifting away.',
         case when v_eligible > 12
           then 'The twelve who came most often get the message; the other '
                || (v_eligible - 12) || ' do not, because past twelve this is '
                || 'a mailshot rather than a nudge.'
           else 'All ' || v_eligible || ' get the message.'
         end
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-class-return-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$$;

revoke all on function public.agent_class_return_tick()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The clock
-- ---------------------------------------------------------------------------
--
-- 09:50, after the plan-upgrade tick at 09:40 so the two noticing jobs
-- meet the shared budget in a fixed order rather than a racing one.

select cron.schedule(
  'agent-class-return-tick',
  '50 9 * * *',
  $$select public.agent_class_return_tick();$$
);

commit;
