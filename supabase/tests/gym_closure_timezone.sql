-- Invariant: a closure means local dates at the gym, not UTC dates. "22
-- December" starts at midnight in the gym's timezone and the end date is
-- inclusive to its last minute.
--
-- Australia/Brisbane (UTC+10, no DST) is used deliberately: both fixtures
-- land on the opposite side of the window from where a naive UTC
-- implementation would put them, so this cannot pass by accident.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@clotz.test');
  v_gym   uuid := _test_mk_gym('TZ Closure', 'clotz');
  v_start date := (current_date + 10);
  v_end   date := (current_date + 20);
  v_dawn  uuid;
  v_dusk  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  -- Raw UPDATE while the session role is still unswitched; _test_act_as
  -- below sets role LOCAL and cannot be reliably undone inside a DO block.
  update public.gyms set timezone = 'Australia/Brisbane' where id = v_gym;

  -- 15:00 UTC the day before the window = 01:00 local on the first day:
  -- inside. A UTC implementation would exclude it.
  v_dawn := _test_mk_session(v_gym, v_owner,
    ((v_start - 1)::text || ' 15:00')::timestamp at time zone 'UTC');

  -- 15:00 UTC on the last day = 01:00 local the day after the window:
  -- outside. A UTC implementation would include it.
  v_dusk := _test_mk_session(v_gym, v_owner,
    (v_end::text || ' 15:00')::timestamp at time zone 'UTC');

  perform set_config('test.dawn', v_dawn::text, true);
  perform set_config('test.dusk', v_dusk::text, true);

  perform _test_act_as(v_owner);
  perform public.close_gym_dates(v_gym, v_start, v_end, null::text, null::uuid[]);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.dawn')::uuid),
  0,
  'a class at 01:00 local on the first day is inside the window'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.dusk')::uuid),
  1,
  'a class at 01:00 local the day after the window is outside it'
);

select * from finish();
rollback;
