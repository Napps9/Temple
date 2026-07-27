-- Invariant: a date-range cover request is a standing window. Classes
-- created into an open window after the request was lodged are offered
-- automatically — which is the whole point of being able to ask for
-- Christmas cover in July, before the schedule has been materialised.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covattach.test');
  v_coach   uuid := _test_mk_user('coach@covattach.test');
  v_gym     uuid := _test_mk_gym('Attach Gym', 'covattach');
  v_start   date := (current_date + 30);
  v_end     date := (current_date + 40);
  v_ct      uuid;
  v_request uuid;
  v_inside  uuid;
  v_outside uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  -- Made up front so the post-request _test_mk_session calls only have
  -- to insert class_sessions, which a coach may do under RLS.
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Attach Test', '#F97316')
    returning id into v_ct;

  perform _test_act_as(v_coach);
  -- No classes exist in the window yet.
  v_request := request_cover_range(v_gym, v_start, v_end, null::uuid[], null::text);

  v_inside := _test_mk_session(v_gym, v_coach,
    (v_start::text || ' 09:00')::timestamp at time zone 'UTC', 60, v_ct);
  v_outside := _test_mk_session(v_gym, v_coach,
    ((v_end + 3)::text || ' 09:00')::timestamp at time zone 'UTC', 60, v_ct);

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.inside',  v_inside::text,  true);
  perform set_config('test.outside', v_outside::text, true);
  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.coach',   v_coach::text,   true);
  perform set_config('test.ct',      v_ct::text,      true);
end;
$$;

-- 1. An empty window is a legitimate request, not an error.
select is(
  (select status from public.cover_requests
     where id = current_setting('test.request')::uuid),
  'open',
  'a window matching no classes still creates an open request'
);

-- 2. A class created into the window afterwards is offered.
select ok(
  exists (
    select 1 from public.cover_request_sessions
    where request_id = current_setting('test.request')::uuid
      and class_session_id = current_setting('test.inside')::uuid
  ),
  'a class scheduled into an open window is auto-offered'
);

-- 3. A class outside the window is not.
select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where class_session_id = current_setting('test.outside')::uuid
  ),
  'a class outside the window is left alone'
);

-- 4. A cancelled window stops attaching.
do $$
declare
  v_late uuid;
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
  perform cancel_cover_request(current_setting('test.request')::uuid);

  v_late := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    ((current_date + 32)::text || ' 09:00')::timestamp at time zone 'UTC',
    60,
    current_setting('test.ct')::uuid);
  perform set_config('test.late', v_late::text, true);
end;
$$;

select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where class_session_id = current_setting('test.late')::uuid
  ),
  'a cancelled window does not attach new classes'
);

select is(
  (select status from public.cover_requests
     where id = current_setting('test.request')::uuid),
  'cancelled',
  'the cancelled window stays cancelled'
);

select * from finish();
rollback;
