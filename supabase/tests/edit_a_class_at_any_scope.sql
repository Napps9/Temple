-- Changing a class that already exists, at the scope you meant (0288), and
-- the two pattern columns that had nowhere to live before 0287.
--
-- The interesting cases are not "did the field change" but what happens to
-- the SCHEDULE behind the classes: rewritten in place when the edit covers
-- its whole life, split when part of it predates the anchor day, and left
-- alone whenever one class had to be skipped — because no pattern describes
-- "all of these except that one", and rewriting it would move the skipped
-- class on the next walk.

begin;
select plan(24);

\ir _helpers.psql

-- ---------------------------------------------------------------------------
-- Fixture. A daily 10:00 schedule that started a week ago and runs a month
-- out, so "this and all future" has siblings both behind and ahead of its
-- anchor. Plus a standalone class holding the coach at one of the slots the
-- series will occupy after the split, which is how the partial-application
-- case below gets its one skipped class.
--
-- Everything here runs before the first _test_act_as except the walk
-- itself: extend_recurrence checks user_belongs_to, so it needs a session,
-- while the raw inserts need to be out from under RLS.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner  uuid := _test_mk_user('owner@editscope.test');
  v_coach  uuid := _test_mk_user('coach@editscope.test');
  -- Takes nothing else anywhere, which the notification test needs: the
  -- clash check below is not gym-scoped, so a coach with classes in the
  -- other gym at an overlapping time would be skipped rather than set.
  v_coach2 uuid := _test_mk_user('coach2@editscope.test');
  v_admin  uuid := _test_mk_user('admin@editscope.test');
  v_member uuid := _test_mk_user('member@editscope.test');
  v_gym    uuid := _test_mk_gym('Edit Scope', 'editscope');
  v_gym2   uuid := _test_mk_gym('Two Times', 'editscope-two');
  v_ct     uuid;
  v_ct2    uuid;
  v_rec    uuid;
  v_recmid uuid;
  v_anchor timestamptz;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_coach2, 'coach');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym2, v_owner, 'owner');
  update public.gyms set timezone = 'UTC' where id in (v_gym, v_gym2);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Barbell', '#2563EB') returning id into v_ct;
  insert into public.class_types (gym_id, name, color)
    values (v_gym2, 'Late One', '#12B76A') returning id into v_ct2;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, ends_on, tz, created_by, location)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date - 7, current_date + 30, 'UTC', v_owner, 'Main floor')
  returning id into v_rec;

  -- A second gym, because the midnight refusal needs a pattern with a time
  -- near the end of the day: the same-day rule bounds the anchor's own
  -- move, so only a SIBLING time can be shunted over midnight.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, ends_on, tz, created_by)
  values
    (v_gym2, v_ct2, array[0,1,2,3,4,5,6], array['10:00', '23:00'], 60, 12,
     current_date, current_date + 14, 'UTC', v_owner)
  returning id into v_recmid;

  -- Holds the coach at 10:30 nine days out, which is where the split
  -- schedule's class lands once the edit below moves it. Deliberately not
  -- part of any series, so it is never inside an edit set.
  insert into public.class_sessions
    (gym_id, name, class_type_id, starts_at, duration_minutes, capacity,
     coach_id, created_by)
  values
    (v_gym, 'Private', v_ct,
     ((current_date + 9)::text || ' 10:30')::timestamp at time zone 'UTC',
     60, 4, v_coach, v_owner);

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, current_date + 30);
  perform public.extend_recurrence(v_recmid, current_date + 14);

  v_anchor := ((current_date + 7)::text || ' 10:00')::timestamp at time zone 'UTC';
  select id into v_sess from public.class_sessions
    where recurrence_id = v_rec and starts_at = v_anchor;

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.owner',  v_owner::text,  false);
  perform set_config('test.coach',  v_coach::text,  false);
  perform set_config('test.coach2', v_coach2::text, false);
  perform set_config('test.admin',  v_admin::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.rec',    v_rec::text,    false);
  perform set_config('test.recmid', v_recmid::text, false);
  perform set_config('test.sess',   v_sess::text,   false);
  perform set_config('test.anchor', v_anchor::text, false);
end $$;

-- 0287's reason for existing. location has been on class_recurrences since
-- 0049 and extend_recurrence never carried it, so every recurring class was
-- created without the room its schedule names.
select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and location = 'Main floor'),
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid),
  'every class the schedule made carries the schedule''s location'
);

-- ---------------------------------------------------------------------------
-- Scope 'one': this class and nothing else, and the schedule stays put.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (public.edit_session_scoped(
     current_setting('test.sess')::uuid, 'one',
     null, null, 20, null, null, false, 'Rig 2', false, null, false
   ) ->> 'schedule'),
  'none',
  'a single-class edit leaves the schedule alone'
);

-- Per column rather than results_eq: the local pgTAP shim compares whole
-- rows as jsonb, so a values() literal never matches a named select and the
-- assertion fails locally on column names while passing in CI. Same values,
-- readable failure in both.
select is(
  (select capacity from public.class_sessions
     where id = current_setting('test.sess')::uuid),
  20,
  'and the class itself carries the new capacity'
);

select is(
  (select location from public.class_sessions
     where id = current_setting('test.sess')::uuid),
  'Rig 2',
  'and the new room'
);

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and capacity = 20),
  1,
  'no sibling was touched'
);

select is(
  (public.edit_session_scoped(
     current_setting('test.sess')::uuid, 'one',
     current_setting('test.anchor')::timestamptz + interval '1 day 90 minutes',
     null, null, null, null, false, null, false, null, false
   ) ->> 'updated')::int,
  1,
  'one class can move to another day, which the series scopes cannot'
);

select is(
  (public.edit_session_scoped(
     current_setting('test.sess')::uuid, 'one',
     current_setting('test.anchor')::timestamptz,
     null, null, null, null, false, null, false, null, false
   ) ->> 'updated')::int,
  1,
  'and back, so the slot is free for the scoped edits below'
);

select throws_ok(
  $$ select public.edit_session_scoped(
       current_setting('test.sess')::uuid, 'one',
       null, null, null, null, null, false, null, false, null, false) $$,
  'Nothing to change',
  'a save with nothing in it is refused'
);

-- ---------------------------------------------------------------------------
-- Scope 'from': part of the schedule predates the anchor day, so it splits.
-- ---------------------------------------------------------------------------
select is(
  (public.edit_session_scoped(
     current_setting('test.sess')::uuid, 'from',
     current_setting('test.anchor')::timestamptz + interval '30 minutes',
     45, 16, null, null, false, null, false, null, false
   ) ->> 'schedule'),
  'split',
  'this-and-all-future splits a schedule that started earlier'
);

select is(
  (select count(*)::int from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid),
  2,
  'into exactly two schedules — this window runs to the end, so never three'
);

select is(
  (select ends_on from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  current_date + 6,
  'the original stops the day before the anchor day'
);

select is(
  (select times || array[duration_minutes::text, capacity::text,
                         starts_on::text, ends_on::text]
     from public.class_recurrences
     where gym_id = current_setting('test.gym')::uuid
       and id <> current_setting('test.rec')::uuid),
  array['10:30', '45', '16',
        (current_date + 7)::text, (current_date + 30)::text],
  'and the new one carries the edit for the rest of the old one''s life'
);

-- The classes have to agree with the pattern that owns their dates, or
-- re-materialising manufactures duplicates instead of no-ops.
select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at >= (current_setting('test.anchor')::timestamptz)),
  0,
  'no class from the anchor day on still belongs to the old schedule'
);

select is(
  (select count(*)::int from public.class_sessions cs
     join public.class_recurrences r on r.id = cs.recurrence_id
    where r.gym_id = current_setting('test.gym')::uuid
      and r.id <> current_setting('test.rec')::uuid
      and (cs.duration_minutes <> 45 or cs.capacity <> 16)),
  0,
  'every class under the new schedule took the edit'
);

-- ---------------------------------------------------------------------------
-- Refusals that protect the pattern.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.edit_session_scoped(
       (select id from public.class_sessions
          where recurrence_id = current_setting('test.recmid')::uuid
            and starts_at > now() order by starts_at limit 1),
       'series',
       (select starts_at + interval '1 day' from public.class_sessions
          where recurrence_id = current_setting('test.recmid')::uuid
            and starts_at > now() order by starts_at limit 1),
       null, null, null, null, false, null, false, null, false) $$,
  'A series keeps its days. Move one class to another day with "Just this one".',
  'a series-scope edit will not move the pattern onto another day'
);

-- The 10:00 moving to 11:30 takes its 23:00 sibling to 00:30, which changes
-- which days_of_week the pattern fires on. Refused before anything applies.
select throws_ok(
  $$ select public.edit_session_scoped(
       (select id from public.class_sessions
          where recurrence_id = current_setting('test.recmid')::uuid
            and starts_at > now()
            and (starts_at at time zone 'UTC')::time = '10:00'
          order by starts_at limit 1),
       'series',
       (select date_trunc('day', starts_at at time zone 'UTC')
                 + interval '11 hours 30 minutes'
          from public.class_sessions
          where recurrence_id = current_setting('test.recmid')::uuid
            and starts_at > now()
            and (starts_at at time zone 'UTC')::time = '10:00'
          order by starts_at limit 1) at time zone 'UTC',
       null, null, null, null, false, null, false, null, false) $$,
  'That would move a class past midnight. Move it by less, or edit the schedule itself.',
  'and will not shunt a sibling time over midnight'
);

-- ---------------------------------------------------------------------------
-- One skipped class means the pattern is left alone, and says so. The
-- standalone Private class holds this coach at the 10:30 nine days out.
-- ---------------------------------------------------------------------------
select is(
  (public.edit_session_scoped(
     (select id from public.class_sessions
        where recurrence_id <> current_setting('test.rec')::uuid
          and gym_id = current_setting('test.gym')::uuid
          and recurrence_id is not null
          and starts_at > now() order by starts_at limit 1),
     'series', null, null, null, null,
     current_setting('test.coach')::uuid, false, null, false, null, false
   ) ->> 'skipped_conflict')::int,
  1,
  'the class whose coach is already busy is skipped'
);

select is(
  (select count(*)::int from public.class_recurrences
    where id <> current_setting('test.rec')::uuid
      and gym_id = current_setting('test.gym')::uuid
      and coach_id is not null),
  0,
  'and because that was a partial application the pattern kept its coach'
);

-- ---------------------------------------------------------------------------
-- 0287's other half. With the clash out of the way the pattern takes the
-- coach, and a class materialised later gets it instead of the author.
-- ---------------------------------------------------------------------------
do $$
begin
  delete from public.class_sessions
    where gym_id = current_setting('test.gym')::uuid
      and recurrence_id is null;
end $$;

select is(
  (public.edit_session_scoped(
     (select id from public.class_sessions
        where recurrence_id <> current_setting('test.rec')::uuid
          and gym_id = current_setting('test.gym')::uuid
          and recurrence_id is not null
          and starts_at > now() order by starts_at limit 1),
     'series', null, null, null, null,
     current_setting('test.coach')::uuid, false, null, false, null, false
   ) ->> 'schedule'),
  'updated',
  'a series-wide coach change rewrites the pattern in place'
);

do $$
declare
  v_rec uuid;
begin
  select id into v_rec from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid
      and id <> current_setting('test.rec')::uuid;
  -- Walking further is what the calendar does on mount. Before 0287 the
  -- classes this produced came back with coach_id = created_by and the
  -- coach change silently un-happened past the horizon.
  update public.class_recurrences set ends_on = current_date + 45 where id = v_rec;
  perform public.extend_recurrence(v_rec, current_date + 45);
  perform set_config('test.rec2', v_rec::text, false);
end $$;

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec2')::uuid
      and starts_at > ((current_date + 31)::text || ' 00:00')::timestamp at time zone 'UTC'
      and coach_id is distinct from current_setting('test.coach')::uuid),
  0,
  'and every class materialised afterwards has that coach, not the author'
);

select isnt(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec2')::uuid
      and starts_at > ((current_date + 31)::text || ' 00:00')::timestamp at time zone 'UTC'),
  0,
  'with classes past the old horizon to say it about'
);

-- 0227's rule, which this RPC has to keep: the coach is often why somebody
-- booked, so a change tells them. Once per member per change, not once per
-- class — a series-wide swap across forty classes is one digest.
do $$
declare
  v_sess uuid;
begin
  select id into v_sess from public.class_sessions
    where recurrence_id = current_setting('test.rec2')::uuid
      and starts_at > now() order by starts_at limit 1;
  perform public.staff_book_member(v_sess, current_setting('test.member')::uuid,
                                   null, null, true, false);
end $$;

select is(
  (public.edit_session_scoped(
     (select id from public.class_sessions
        where recurrence_id = current_setting('test.rec2')::uuid
          and starts_at > now() order by starts_at limit 1),
     'series', null, null, null, null,
     current_setting('test.coach2')::uuid, false, null, false, null, false
   ) ->> 'notified')::int,
  1,
  'a series-wide coach change is one digest for the one member booked'
);

select is(
  (public.edit_session_scoped(
     (select id from public.class_sessions
        where recurrence_id = current_setting('test.rec2')::uuid
          and starts_at > now() order by starts_at limit 1),
     'series', null, null, null, null,
     current_setting('test.coach2')::uuid, false, null, false, null, false
   ) ->> 'notified')::int,
  0,
  'and saving the same coach again tells nobody'
);

select throws_ok(
  $$ select public.edit_session_scoped(
       current_setting('test.sess')::uuid, 'one',
       null, null, null, null,
       current_setting('test.admin')::uuid, false, null, false, null, false) $$,
  'Only an owner or a coach can be put on a class',
  'an admin cannot be put in front of a class'
);

select * from finish();
rollback;
