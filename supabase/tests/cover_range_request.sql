-- Invariant: request_cover_range resolves a date window to exactly the
-- caller's classes inside it — inclusive of the final day, exclusive of
-- everything either side — and records the requested dates alongside the
-- resolved timestamptz window.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covrange.test');
  v_coach   uuid := _test_mk_user('coach@covrange.test');
  v_other   uuid := _test_mk_user('other@covrange.test');
  v_gym     uuid := _test_mk_gym('Range Gym', 'covrange');
  v_start   date := (current_date + 10);
  v_end     date := (current_date + 20);
  v_before  uuid;
  v_first   uuid;
  v_last    uuid;
  v_after   uuid;
  v_excl    uuid;
  v_offered uuid;
  v_theirs  uuid;
  v_request uuid;
  v_prior   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_other, 'coach');

  -- The gym runs on UTC (the _test_mk_gym default); build every fixture
  -- time the same way the RPC builds its window so the assertions don't
  -- depend on the session's TimeZone setting.
  v_before := _test_mk_session(v_gym, v_coach,
    ((v_start - 1)::text || ' 18:00')::timestamp at time zone 'UTC');
  v_first := _test_mk_session(v_gym, v_coach,
    (v_start::text || ' 06:00')::timestamp at time zone 'UTC');
  v_last := _test_mk_session(v_gym, v_coach,
    (v_end::text || ' 23:00')::timestamp at time zone 'UTC');
  v_after := _test_mk_session(v_gym, v_coach,
    ((v_end + 1)::text || ' 06:00')::timestamp at time zone 'UTC');
  v_excl := _test_mk_session(v_gym, v_coach,
    (v_start::text || ' 10:00')::timestamp at time zone 'UTC');
  v_offered := _test_mk_session(v_gym, v_coach,
    (v_start::text || ' 12:00')::timestamp at time zone 'UTC');
  v_theirs := _test_mk_session(v_gym, v_other,
    (v_start::text || ' 14:00')::timestamp at time zone 'UTC');

  -- v_offered already sits in the feed under an earlier per-class request.
  insert into public.cover_requests
    (gym_id, requested_by, range_start, range_end)
  values
    (v_gym, v_coach,
     (v_start::text || ' 12:00')::timestamp at time zone 'UTC',
     (v_start::text || ' 13:00')::timestamp at time zone 'UTC')
  returning id into v_prior;
  insert into public.cover_request_sessions
    (request_id, class_session_id, original_coach_id, gym_id)
  values (v_prior, v_offered, v_coach, v_gym);

  perform _test_act_as(v_coach);
  v_request := request_cover_range(
    v_gym, v_start, v_end, array[v_excl], 'Away over the break'
  );

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.before',  v_before::text,  true);
  perform set_config('test.last',    v_last::text,    true);
  perform set_config('test.after',   v_after::text,   true);
  perform set_config('test.excl',    v_excl::text,    true);
  perform set_config('test.offered', v_offered::text, true);
  perform set_config('test.theirs',  v_theirs::text,  true);
  perform set_config('test.start',   v_start::text,   true);
  perform set_config('test.end',     v_end::text,     true);
end;
$$;

-- 1. Exactly the two eligible classes: in-window, not excluded, not
--    already offered, coached by the caller.
select is(
  (select count(*)::int from public.cover_request_sessions
     where request_id = current_setting('test.request')::uuid),
  2,
  'range request offers only the eligible in-window classes'
);

-- 2. A 23:00 class on the final day is inside — the window runs to
--    midnight of the following day, not midnight of the end date.
select ok(
  exists (
    select 1 from public.cover_request_sessions
    where request_id = current_setting('test.request')::uuid
      and class_session_id = current_setting('test.last')::uuid
  ),
  'a 23:00 class on the final day is inside the window'
);

-- 3. Classes on the days either side are untouched.
select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where request_id = current_setting('test.request')::uuid
      and class_session_id in (
        current_setting('test.before')::uuid,
        current_setting('test.after')::uuid
      )
  ),
  'classes on the days either side of the window are excluded'
);

-- 4. p_exclude_session_ids is honoured.
select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where request_id = current_setting('test.request')::uuid
      and class_session_id = current_setting('test.excl')::uuid
  ),
  'an unticked class gets no offer'
);

-- 5. A class already carrying an open offer is skipped rather than
--    hitting cover_request_sessions_open_session_uniq.
select is(
  (select count(*)::int from public.cover_request_sessions
     where class_session_id = current_setting('test.offered')::uuid),
  1,
  'a class already in the feed is skipped rather than double-offered'
);

-- 6. Another coach's class in the same window is left alone.
select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where class_session_id = current_setting('test.theirs')::uuid
  ),
  'a class coached by someone else is not offered'
);

-- 7. The requested dates are stored verbatim, for display that does not
--    drift with the viewer timezone.
select is(
  (select requested_start::text || '/' || requested_end::text
     from public.cover_requests
     where id = current_setting('test.request')::uuid),
  current_setting('test.start') || '/' || current_setting('test.end'),
  'the requested dates are recorded on the header'
);

select * from finish();
rollback;
