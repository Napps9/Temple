-- Moving one class, and putting a different coach on it (0224)
--
-- Both writes are new. What is checked here is the set of refusals: a
-- class that has already run, a slot inside a live closure, a coach who
-- is double-booked or unqualified, and somebody who does not hold
-- can_edit_classes.

begin;
select plan(15);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@move.test');
  v_coach  uuid := _test_mk_user('coach@move.test');
  v_coach2 uuid := _test_mk_user('coach2@move.test');
  v_admin  uuid := _test_mk_user('admin@move.test');
  v_member uuid := _test_mk_user('member@move.test');
  v_gym    uuid := _test_mk_gym('Move Gym', 'move-gym');
  v_type   uuid;
  v_future uuid;
  v_past   uuid;
  v_clash  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_coach2, 'coach');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'Barbell', '#2563EB') returning id into v_type;

  v_future := _test_mk_session(v_gym, v_coach, now() + interval '3 days');
  v_past   := _test_mk_session(v_gym, v_coach, now() - interval '3 days');
  -- Sits at the time the future class is moved TO, so it is the overlap
  -- the double-booking check has to catch.
  v_clash  := _test_mk_session(v_gym, v_coach2, now() + interval '5 days');

  update public.class_sessions set class_type_id = v_type where id = v_future;

  -- coach2 is explicitly not qualified for Barbell.
  insert into public.coach_class_type_qualifications
    (gym_id, profile_id, class_type_id, qualified)
  values (v_gym, v_coach2, v_type, false);

  insert into public.gym_closures (gym_id, starts_on, ends_on, reason, created_by)
  values (v_gym, (now() + interval '20 days')::date,
                 (now() + interval '25 days')::date, 'Christmas', v_owner);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.coach2', v_coach2::text, true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.future', v_future::text, true);
  perform set_config('test.past',   v_past::text,   true);
  perform set_config('test.clash',  v_clash::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- Moving one class
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() + interval ''5 days'')',
    current_setting('test.future')
  ),
  null, 'Not authorised',
  'a member cannot move a class'
);

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() + interval ''5 days'', 75)',
    current_setting('test.future')
  ),
  'a coach with can_edit_classes can move one'
);

select ok(
  (select starts_at > now() + interval '4 days'
     from public.class_sessions
     where id = current_setting('test.future')::uuid),
  'and it is at the new time'
);

select is(
  (select duration_minutes from public.class_sessions
     where id = current_setting('test.future')::uuid),
  75,
  'with the new length'
);

select throws_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() + interval ''5 days'')',
    current_setting('test.past')
  ),
  null, 'That class has already run',
  'a class that has already run cannot be moved — its attendance is a record'
);

select throws_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() - interval ''1 day'')',
    current_setting('test.future')
  ),
  null, 'Pick a time in the future',
  'nor moved into the past'
);

select throws_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() + interval ''22 days'')',
    current_setting('test.future')
  ),
  null, null,
  'nor into a live closure — the suppression trigger is insert-only, so this is the only guard'
);

select throws_ok(
  format(
    'select public.reschedule_session(%L::uuid, now() + interval ''5 days'', 2)',
    current_setting('test.future')
  ),
  null, 'A class runs between 5 minutes and 8 hours',
  'and a two-minute class is a typo, not a class'
);

-- ---------------------------------------------------------------------------
-- Putting a different coach on it
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.coach2')
  ),
  null, 'Not authorised',
  'a member cannot reassign a class'
);

select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.coach2')
  ),
  null, 'They are not qualified to take that class',
  'and nobody can be put in front of a class type they are marked unqualified for'
);

select throws_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.admin')
  ),
  null, 'Only an owner or a coach can be put on a class',
  'an admin does not coach — the same rule claim_cover has always had'
);

select throws_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.member')
  ),
  null, 'Only an owner or a coach can be put on a class',
  'nor does a member'
);

select lives_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.owner')
  ),
  'a free coach can be put on it'
);

select is(
  (select coach_id from public.class_sessions
     where id = current_setting('test.future')::uuid),
  current_setting('test.owner')::uuid,
  'and the session says so'
);

select throws_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.clash'), current_setting('test.owner')
  ),
  null, 'They are already coaching at that time',
  'but not onto a class that overlaps the one they were just given'
);

select * from finish();
rollback;
