-- Unticking some of the classes makes the change inexpressible as a
-- pattern — "these Tuesdays but not that one" is not a recurrence. The
-- sessions still move, the schedule is deliberately left alone, and the
-- result says so rather than rewriting a pattern that would move the
-- untouched class on the next walk.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@recpartial.test');
  v_gym    uuid := _test_mk_gym('Partial', 'recpartial');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := current_date + 10;
  v_end    date := current_date + 16;
  v_picked uuid[];
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Partial', '#2563EB')
    returning id into v_ct;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_end + 5);

  -- Two of the seven days in the window.
  select array_agg(id) into v_picked from (
    select id from public.class_sessions
    where recurrence_id = v_rec
      and starts_at::date between v_start and v_end
    order by starts_at limit 2
  ) s;

  v_result := public.bulk_edit_sessions(
    v_gym, v_start, v_end, v_picked, null::int, null::int, 60);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.rec',    v_rec::text,    true);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (current_setting('test.result')::jsonb ->> 'updated')::int,
  2,
  'only the ticked classes moved'
);

select is(
  (current_setting('test.result')::jsonb ->> 'recurrences_unchanged')::int,
  1,
  'the schedule is reported as left alone'
);

select is(
  (current_setting('test.result')::jsonb ->> 'recurrences_split')::int,
  0,
  'and was not split'
);

select is(
  (select times from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  array['10:00'],
  'the pattern still describes the classes that were not touched'
);

select * from finish();
rollback;
