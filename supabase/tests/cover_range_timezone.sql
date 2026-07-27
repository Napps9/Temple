-- Invariant: a cover date range means local dates at the gym, not UTC
-- dates. "22 December" starts at midnight in the gym's timezone.
--
-- Australia/Brisbane (UTC+10, no DST) is used deliberately: both
-- fixtures below land on the opposite side of the window from where a
-- naive UTC implementation would put them, so this test cannot pass by
-- accident.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covtz.test');
  v_coach   uuid := _test_mk_user('coach@covtz.test');
  v_gym     uuid := _test_mk_gym('TZ Gym', 'covtz');
  v_start   date := (current_date + 10);
  v_end     date := (current_date + 20);
  v_dawn    uuid;
  v_dusk    uuid;
  v_request uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  -- Raw UPDATE while the session role is still unswitched; _test_act_as
  -- below sets role LOCAL and cannot be reliably undone inside a DO block.
  update public.gyms set timezone = 'Australia/Brisbane' where id = v_gym;

  -- 15:00 UTC the day before the window = 01:00 local on the first day:
  -- inside. A UTC implementation would exclude it.
  v_dawn := _test_mk_session(v_gym, v_coach,
    ((v_start - 1)::text || ' 15:00')::timestamp at time zone 'UTC');

  -- 15:00 UTC on the last day = 01:00 local the day after the window:
  -- outside. A UTC implementation would include it.
  v_dusk := _test_mk_session(v_gym, v_coach,
    (v_end::text || ' 15:00')::timestamp at time zone 'UTC');

  perform _test_act_as(v_coach);
  v_request := request_cover_range(v_gym, v_start, v_end, null::uuid[], null::text);

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.dawn',    v_dawn::text,    true);
  perform set_config('test.dusk',    v_dusk::text,    true);
end;
$$;

select ok(
  exists (
    select 1 from public.cover_request_sessions
    where request_id = current_setting('test.request')::uuid
      and class_session_id = current_setting('test.dawn')::uuid
  ),
  'a class at 01:00 local on the first day is inside the window'
);

select ok(
  not exists (
    select 1 from public.cover_request_sessions
    where class_session_id = current_setting('test.dusk')::uuid
  ),
  'a class at 01:00 local the day after the window is outside it'
);

select is(
  (select count(*)::int from public.cover_request_sessions
     where request_id = current_setting('test.request')::uuid),
  1,
  'exactly one class falls inside the local-date window'
);

select * from finish();
rollback;
