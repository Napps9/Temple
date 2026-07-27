-- Reopening tells the members who lost a booking to that exact class, and
-- nobody else. The credit went back when the gym shut, so the class
-- returning is only useful to them if they know to rebook it.
--
-- Matching is by pattern slot (recurrence_id, starts_at), snapshotted at
-- closure time — the session that comes back is a different row from the
-- one that was deleted, so a session id would match nothing.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@reopennotif.test');
  v_monday  uuid := _test_mk_user('monday@reopennotif.test');
  v_friday  uuid := _test_mk_user('friday@reopennotif.test');
  v_gym     uuid := _test_mk_gym('Reopen Notif', 'reopennotif');
  v_ct      uuid;
  v_rec     uuid;
  v_start   date := current_date + 10;
  v_end     date := current_date + 16;
  v_first   uuid;
  v_last    uuid;
  v_result  jsonb;
  v_closure uuid;
  v_exclude jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_monday, 'member');
  perform _test_mk_membership(v_gym, v_friday, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Daily', '#2563EB')
    returning id into v_ct;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  -- Claim + jwt only, no role switch: extend_recurrence needs auth.uid(),
  -- the fixture bookings need to bypass RLS, and _test_act_as sets role
  -- LOCAL in a way a DO block cannot reliably undo.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform public.extend_recurrence(v_rec, v_end + 5);

  select id into v_first from public.class_sessions
    where recurrence_id = v_rec and starts_at::date = v_start;
  select id into v_last from public.class_sessions
    where recurrence_id = v_rec and starts_at::date = v_end;

  -- One member on the day that will be reopened, one on a day that stays
  -- shut.
  perform _test_mk_booking(v_first, v_monday);
  perform _test_mk_booking(v_last,  v_friday);

  perform _test_act_as(v_owner);
  v_result  := public.close_gym_dates(v_gym, v_start, v_end, 'Shut', null::uuid[]);
  v_closure := (v_result ->> 'closure_id')::uuid;

  -- Reopen the first day only.
  select jsonb_agg(jsonb_build_object(
           'recurrence_id', p.recurrence_id,
           'starts_at',     p.starts_at))
    into v_exclude
  from public.preview_closure_reopen(v_closure) p
  where p.local_date <> v_start;

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.closure', v_closure::text, true);
  perform set_config('test.monday',  v_monday::text,  true);
  perform set_config('test.friday',  v_friday::text,  true);
  perform set_config('test.exclude', v_exclude::text, true);
end;
$$;

select is(
  (select count(*)::int from public.closure_cancelled_bookings
    where closure_id = current_setting('test.closure')::uuid),
  2,
  'closing recorded both cancelled bookings against their pattern slots'
);

select is(
  ((select public.reopen_closure(
      current_setting('test.closure')::uuid,
      current_setting('test.exclude')::jsonb)) ->> 'notified')::int,
  1,
  'reopening one day tells exactly one member'
);

select is(
  (select count(*)::int from public.class_change_notifications
    where kind = 'classes_reopened'
      and recipient_profile_id = current_setting('test.monday')::uuid),
  2,
  'the member whose class came back gets one in-app and one email'
);

select is(
  (select count(*)::int from public.class_change_notifications
    where kind = 'classes_reopened'
      and recipient_profile_id = current_setting('test.friday')::uuid),
  0,
  'the member whose day is still shut is not told'
);

select ok(
  (select body from public.class_change_notifications
    where kind = 'classes_reopened'
      and channel = 'in_app'
      and recipient_profile_id = current_setting('test.monday')::uuid)
    like '%book again%',
  'and the message says they have to book again'
);

-- Re-running the identical reopen must not mail anyone twice.
select is(
  ((select public.reopen_closure(
      current_setting('test.closure')::uuid,
      current_setting('test.exclude')::jsonb)) ->> 'notified')::int,
  0,
  'a repeat of the same reopen tells nobody again'
);

select * from finish();
rollback;
