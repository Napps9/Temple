-- Who has stopped coming (0231)
--
-- The two ways this question is easy to answer wrongly: calling a new
-- member quiet because they have not been in yet, and reporting somebody
-- who never came as though they came once and stopped.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@quiet.test');
  v_coach  uuid := _test_mk_user('coach@quiet.test');
  v_reg    uuid := _test_mk_user('regular@quiet.test');
  v_lapsed uuid := _test_mk_user('lapsed@quiet.test');
  v_never  uuid := _test_mk_user('never@quiet.test');
  v_new    uuid := _test_mk_user('new@quiet.test');
  v_left   uuid := _test_mk_user('left@quiet.test');
  v_out    uuid := _test_mk_user('outsider@quiet.test');
  v_gym    uuid := _test_mk_gym('Quiet Gym', 'quiet');
  v_s_old  uuid;
  v_s_now  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_reg,    'member');
  perform _test_mk_membership(v_gym, v_lapsed, 'member');
  perform _test_mk_membership(v_gym, v_never,  'member');
  perform _test_mk_membership(v_gym, v_new,    'member');
  perform _test_mk_membership(v_gym, v_left,   'member');

  update public.profiles set full_name = 'Lapsed Larry'  where id = v_lapsed;
  update public.profiles set full_name = 'Never Nadia'   where id = v_never;

  -- Never Nadia joined months ago and has still not been in. Newton
  -- joined yesterday, which is not the same thing.
  update public.gym_memberships set created_at = now() - interval '500 days'
    where gym_id = v_gym and profile_id = v_never;
  update public.gym_memberships set created_at = now() - interval '1 day'
    where gym_id = v_gym and profile_id = v_new;

  -- Somebody who left the gym is not a member who has gone quiet.
  update public.gym_memberships set left_at = now() - interval '10 days'
    where gym_id = v_gym and profile_id = v_left;

  v_s_old := _test_mk_session(v_gym, v_coach, now() - interval '70 days');
  v_s_now := _test_mk_session(v_gym, v_coach, now() - interval '2 days');

  -- marked_by is required whenever a register was taken (0013).
  insert into public.class_bookings
    (gym_id, class_session_id, profile_id, attended_at, marked_by)
  values
    (v_gym, v_s_old, v_lapsed, now() - interval '70 days', v_coach),
    (v_gym, v_s_now, v_reg,    now() - interval '2 days',  v_coach),
    (v_gym, v_s_old, v_left,   now() - interval '70 days', v_coach);

  -- A booking with no attended_at is not an attendance: it is somebody
  -- who booked and whose register was never taken.
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, v_s_now, v_lapsed);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.lapsed', v_lapsed::text, true);
  perform set_config('test.never',  v_never::text,  true);
  perform set_config('test.out',    v_out::text,    true);
end $$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4)),
  2,
  'two members have gone quiet — not the regular, not the new one, not the one who left'
);

select is(
  (select profile_id from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4) limit 1),
  current_setting('test.never')::uuid,
  'the longest gone comes first, and never-been sorts by how long they have been a member'
);

select is(
  (select weeks_absent from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4)
     where profile_id = current_setting('test.lapsed')::uuid),
  10,
  'ten weeks since Larry was last in'
);

select is(
  (select weeks_absent from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4)
     where profile_id = current_setting('test.never')::uuid),
  null,
  'and never-been is null rather than a made-up number of weeks'
);

select is(
  (select last_seen from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4)
     where profile_id = current_setting('test.never')::uuid),
  null,
  'because there is no last time'
);

-- A booking nobody marked is not an attendance. If it counted, Larry
-- would look like he was in two days ago.
select ok(
  (select last_seen < now() - interval '60 days'
     from public.gym_quiet_members(current_setting('test.gym')::uuid, 4)
     where profile_id = current_setting('test.lapsed')::uuid),
  'an unmarked booking does not count as having been in'
);

-- ---------------------------------------------------------------------------
-- The window
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 52)),
  1,
  'asked about a year, only the one who never came qualifies'
);

select is(
  (select count(*)::int from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 1)),
  2,
  'asked about a week, the regular who came two days ago still does not'
);

select is(
  (select count(*)::int from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 999)),
  1,
  'an absurd window is clamped rather than refused'
);

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.gym_quiet_members(
     current_setting('test.gym')::uuid, 4)),
  2,
  'a coach who takes the register may ask who is missing from it'
);

select _test_act_as(current_setting('test.out')::uuid);

select throws_ok(
  format('select * from public.gym_quiet_members(%L::uuid, 4)', current_setting('test.gym')),
  null, 'Not authorised',
  'somebody outside the gym is refused'
);

select * from finish();
rollback;
