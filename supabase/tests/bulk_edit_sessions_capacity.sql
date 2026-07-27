-- bulk_edit_sessions applies capacity across a window, and refuses to
-- over-subscribe: a class with more members booked than the new capacity
-- is left alone and counted, rather than aborting the whole run.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@bulkcap.test');
  v_a      uuid := _test_mk_user('a@bulkcap.test');
  v_b      uuid := _test_mk_user('b@bulkcap.test');
  v_c      uuid := _test_mk_user('c@bulkcap.test');
  v_gym    uuid := _test_mk_gym('Bulk Cap', 'bulkcap');
  v_start  date := (current_date + 10);
  v_end    date := (current_date + 20);
  v_quiet  uuid;
  v_busy   uuid;
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');

  v_quiet := _test_mk_session(v_gym, v_owner, (v_start::text || ' 10:00')::timestamptz);
  v_busy  := _test_mk_session(v_gym, v_owner, (v_start::text || ' 18:00')::timestamptz);

  perform _test_mk_booking(v_busy, v_a);
  perform _test_mk_booking(v_busy, v_b);
  perform _test_mk_booking(v_busy, v_c);

  perform set_config('test.quiet', v_quiet::text, true);
  perform set_config('test.busy',  v_busy::text,  true);

  perform _test_act_as(v_owner);
  v_result := public.bulk_edit_sessions(
    v_gym, v_start, v_end, null::uuid[], 2, null::int, null::int);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (select capacity from public.class_sessions
    where id = current_setting('test.quiet')::uuid),
  2,
  'an empty class takes the new capacity'
);

select is(
  (select capacity from public.class_sessions
    where id = current_setting('test.busy')::uuid),
  12,
  'a class with 3 booked keeps its old capacity'
);

select is(
  (current_setting('test.result')::jsonb ->> 'updated')::int,
  1,
  'the result counts one update'
);

select is(
  (current_setting('test.result')::jsonb ->> 'skipped_overbooked')::int,
  1,
  'and names the one it could not shrink'
);

select * from finish();
rollback;
