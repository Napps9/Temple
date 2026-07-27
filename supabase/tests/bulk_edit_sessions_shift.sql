-- Shifting a run of recurring classes by a constant moves each one onto
-- the slot its neighbour is vacating. bulk_edit_sessions walks away from
-- the direction of travel so class_sessions_recurrence_starts_unique is
-- never transiently violated.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@bulkshift.test');
  v_gym    uuid := _test_mk_gym('Bulk Shift', 'bulkshift');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := (current_date + 10);
  v_end    date := (current_date + 16);
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Shifted', '#2563EB')
    returning id into v_ct;

  -- Two slots a day, 24h apart in the series but only 60 minutes apart on
  -- the clock, so a +60 shift lands each one exactly where its sibling was.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00','11:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_end);

  v_result := public.bulk_edit_sessions(
    v_gym, v_start, v_end, null::uuid[], null::int, 45, 60);

  perform set_config('test.rec',    v_rec::text,    true);
  perform set_config('test.start',  v_start::text,  true);
  perform set_config('test.end',    v_end::text,    true);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (current_setting('test.result')::jsonb ->> 'skipped_conflict')::int,
  0,
  'shifting a whole series forward hits no unique-index conflict'
);

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date
      and starts_at::time in ('11:00', '12:00')),
  (current_setting('test.result')::jsonb ->> 'updated')::int,
  'every shifted class moved an hour later'
);

select is(
  (select count(distinct duration_minutes)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date),
  1,
  'and they all took the new length'
);

select * from finish();
rollback;
