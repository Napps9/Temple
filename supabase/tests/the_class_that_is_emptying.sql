-- The class that is emptying (0246).
--
-- The seventh job, and the first that proposes about a slot rather than a
-- person. Two things make it worth its own file rather than a copy of the
-- other jobs' tests:
--
--   the recipients are a LIST, and the count on the owner's card and the
--   number of emails have to be the same number — they were computed by
--   two copies of the same predicate in the first draft, which is the
--   state a rule is in just before its halves stop agreeing
--
--   the rule that keeps it out of retention's way is a positive one, not
--   an exclusion: only people who are STILL TRAINING HERE. Somebody who
--   stopped altogether is retention's, and the message this job sends
--   would be false about them.
--
-- The gym's timezone is deliberately not UTC. Slots are grouped by local
-- weekday and local clock time, so a test that runs in UTC proves nothing
-- about a gym in Sydney.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@fading.test');
  v_coach uuid := _test_mk_user('coach@fading.test');
  v_gym   uuid := _test_mk_gym('Fading Gym', 'fading-gym');
  v_ct    uuid;
  v_other uuid;
  v_sess  uuid;
  v_book  uuid;
  v_mem   uuid;
  v_left  uuid;
  v_gone  uuid;
  v_slot  timestamptz;
  v_when  timestamptz;
  i       integer;
  w       integer;
  n       integer;
  regs    uuid[] := '{}';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  update public.gyms set timezone = 'Australia/Sydney' where id = v_gym;

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'CrossFit', '#2563EB') returning id into v_ct;
  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'Yoga', '#10B981') returning id into v_other;

  -- Eight people who came to the fading slot regularly in the earlier
  -- window. Six of them stop; two keep coming.
  for i in 1..8 loop
    v_mem := _test_mk_user('reg' || i || '@fading.test');
    perform _test_mk_membership(v_gym, v_mem, 'member');
    regs := regs || v_mem;
  end loop;

  -- Somebody who used to come, has stopped, and has LEFT the gym.
  v_left := _test_mk_user('left@fading.test');
  perform _test_mk_membership(v_gym, v_left, 'member');
  -- Somebody who used to come and has stopped training entirely. This is
  -- retention's person, not this job's.
  v_gone := _test_mk_user('gone@fading.test');
  perform _test_mk_membership(v_gym, v_gone, 'member');

  -- Eight weekly sessions of the fading slot at local 06:00 Sydney, on
  -- day offsets 3, 10, 17, 24 (recent) and 31, 38, 45, 52 (earlier).
  --
  -- Deliberately clear of both window edges. 06:00 Sydney is 19:00 UTC
  -- the day before, so a session dated exactly 28 or 56 days back lands
  -- on whichever side of `now() - interval '28 days'` the clock happens
  -- to make it — which is a real property of the boundary and a terrible
  -- thing to build a fixture on. The first draft did, and read 8.0 where
  -- it meant 10.0 because one session had drifted across.
  for w in 1..8 loop
    v_slot := ((current_date - (3 + (w - 1) * 7))::text || ' 06:00')::timestamp
              at time zone 'Australia/Sydney';
    v_sess := _test_mk_session(v_gym, v_coach, v_slot, 60, v_ct);

    if w >= 5 then
      -- Earlier window: all eight regulars, plus the two who will vanish.
      for i in 1..8 loop
        v_book := _test_mk_booking(v_sess, regs[i]);
        update public.class_bookings set attended_at = v_slot, marked_by = v_coach
          where id = v_book;
      end loop;
      v_book := _test_mk_booking(v_sess, v_left);
      update public.class_bookings set attended_at = v_slot, marked_by = v_coach
        where id = v_book;
      v_book := _test_mk_booking(v_sess, v_gone);
      update public.class_bookings set attended_at = v_slot, marked_by = v_coach
        where id = v_book;
    else
      -- Recent window: only two of the eight still turn up. 10 a session
      -- down to 2 — well past both the 40% and the two-a-session floors.
      for i in 1..2 loop
        v_book := _test_mk_booking(v_sess, regs[i]);
        update public.class_bookings set attended_at = v_slot, marked_by = v_coach
          where id = v_book;
      end loop;
    end if;
  end loop;

  -- The six who stopped coming to 6am are still training here — they
  -- moved to Yoga. This is what makes them this job's and not
  -- retention's, and it is the predicate the job turns on.
  for w in 1..3 loop
    v_when := ((current_date - (5 + (w - 1) * 7))::text || ' 18:00')::timestamp
              at time zone 'Australia/Sydney';
    v_sess := _test_mk_session(v_gym, v_coach, v_when, 60, v_other);
    for i in 3..8 loop
      v_book := _test_mk_booking(v_sess, regs[i]);
      update public.class_bookings set attended_at = v_when, marked_by = v_coach
        where id = v_book;
    end loop;
    -- The leaver kept training too, right up until they left.
    v_book := _test_mk_booking(v_sess, v_left);
    update public.class_bookings set attended_at = v_when, marked_by = v_coach
      where id = v_book;
  end loop;

  update public.gym_memberships set left_at = now()
    where gym_id = v_gym and profile_id = v_left;

  -- A healthy slot that must never be proposed for: same class type, a
  -- different day, steady all eight weeks.
  for w in 1..8 loop
    v_slot := ((current_date - (2 + (w - 1) * 7))::text || ' 06:00')::timestamp
              at time zone 'Australia/Sydney';
    v_sess := _test_mk_session(v_gym, v_coach, v_slot, 60, v_ct);
    for i in 1..6 loop
      v_book := _test_mk_booking(v_sess, regs[i]);
      update public.class_bookings set attended_at = v_slot, marked_by = v_coach
        where id = v_book;
    end loop;
  end loop;

  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.ct',   v_ct::text,   true);
  perform set_config('test.gone', v_gone::text, true);
  perform set_config('test.left', v_left::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- No authority row means no job at all
-- ---------------------------------------------------------------------------

select agent_class_return_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'class_return_message'),
  0,
  'a gym that has not taken the job on hears nothing, however bad the class'
);

-- ---------------------------------------------------------------------------
-- Switched on
-- ---------------------------------------------------------------------------

insert into public.agent_authority (gym_id, action_kind, level)
values (current_setting('test.gym')::uuid, 'class_return_message', 'approval');
insert into public.agent_message_templates (gym_id, kind, body) values
  (current_setting('test.gym')::uuid, 'class_return_message',
   'Hi {first_name} — {gym_name} here about {class_name}.');

select agent_class_return_tick();

select is(
  (select count(*)::int from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'class_return_message'),
  1,
  'the gym gets exactly one question, not one per slot'
);

-- The label is what the owner reads on the card and what the member reads
-- in the message, so it is built from the gym's own clock, not UTC.
select is(
  (select payload->>'class_label' from public.agent_actions
    where gym_id = current_setting('test.gym')::uuid
      and action_kind = 'class_return_message'),
  trim(to_char(current_date - 3, 'FMDay')) || ' 6am CrossFit',
  'and it is named by the gym''s local weekday and clock time'
);

select is(
  (select (payload->>'was_average')::numeric from public.agent_actions
    where action_kind = 'class_return_message'),
  10.0,
  'the card carries what it used to average'
);

select is(
  (select (payload->>'now_average')::numeric from public.agent_actions
    where action_kind = 'class_return_message'),
  2.0,
  'and what it averages now'
);

-- ---------------------------------------------------------------------------
-- Who is on the list, and who is deliberately not
-- ---------------------------------------------------------------------------

select is(
  (select (payload->>'eligible')::int from public.agent_actions
    where action_kind = 'class_return_message'),
  6,
  'six people used to come, have stopped, and are still training here'
);

select is(
  (select jsonb_array_length(payload->'recipients') from public.agent_actions
    where action_kind = 'class_return_message'),
  6,
  'and the list the message goes to is the same six the card counted'
);

-- The one the job exists to leave alone. Somebody who stopped training
-- altogether is retention's, and "we have missed you at the Tuesday 6am"
-- is the wrong sentence for them.
select is(
  (select count(*)::int from public.agent_actions
    where action_kind = 'class_return_message'
      and payload->'recipients' @> jsonb_build_array(
        jsonb_build_object('profile_id', current_setting('test.gone')))),
  0,
  'somebody who stopped training entirely is left to retention'
);

select is(
  (select count(*)::int from public.agent_actions
    where action_kind = 'class_return_message'
      and payload::text like '%' || current_setting('test.left') || '%'),
  0,
  'and somebody who left the gym is not written to at all'
);

-- ---------------------------------------------------------------------------
-- Approval sends one message each; nothing goes out before that
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.agent_outbound_messages
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'at approval level the proposal waits and nobody is emailed'
);

update public.agent_actions set status = 'approved', decided_at = now()
  where action_kind = 'class_return_message';
select _agent_execute_action(
  (select id from public.agent_actions where action_kind = 'class_return_message'));

select is(
  (select count(*)::int from public.agent_outbound_messages
    where gym_id = current_setting('test.gym')::uuid),
  6,
  'one tap, six emails — the first action in the framework that fans out'
);

-- Re-running must not double-mail anybody: the key is per recipient, not
-- per action, which is the whole reason the branch exists.
update public.agent_actions set status = 'approved'
  where action_kind = 'class_return_message';
select _agent_execute_action(
  (select id from public.agent_actions where action_kind = 'class_return_message'));

select is(
  (select count(*)::int from public.agent_outbound_messages
    where gym_id = current_setting('test.gym')::uuid),
  6,
  'and executing twice sends nobody a second copy'
);

select finish();
rollback;
