-- Shifting part of an open-ended schedule splits it into three: the days
-- before the window keep the old pattern, the window gets the shifted
-- one, and the days after go back to the old one. Without the split the
-- pattern and the calendar disagree, and the next walk re-creates the
-- original slots alongside the moved ones.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@recsplit.test');
  v_gym    uuid := _test_mk_gym('Split Gym', 'recsplit');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := current_date + 10;
  v_end    date := current_date + 16;
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Splittable', '#2563EB')
    returning id into v_ct;

  -- Every day at 10:00, starting before the window and never ending, so
  -- the window is a strict subset in both directions.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_end + 10);

  v_result := public.bulk_edit_sessions(
    v_gym, v_start, v_end, null::uuid[], null::int, null::int, 60);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.rec',    v_rec::text,    true);
  perform set_config('test.start',  v_start::text,  true);
  perform set_config('test.end',    v_end::text,    true);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (current_setting('test.result')::jsonb ->> 'recurrences_split')::int,
  1,
  'the schedule was split rather than left behind'
);

select is(
  (select count(*)::int from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid),
  3,
  'three schedules now cover before / during / after the window'
);

select is(
  (select ends_on from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  (current_setting('test.start')::date - 1),
  'the original schedule stops the day before the window'
);

select is(
  (select times from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid
      and starts_on = current_setting('test.start')::date),
  array['11:00'],
  'the window schedule carries the shifted time'
);

select is(
  (select times from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid
      and starts_on = current_setting('test.end')::date + 1),
  array['10:00'],
  'and the schedule after the window goes back to the original time'
);

-- The whole point: a later pattern edit must not resurrect 10:00 inside
-- the window. Adding a time is the edit that nulls materialized_until
-- (0078) and forces a full re-walk.
select lives_ok(
  $$ update public.class_recurrences set times = times || array['19:00']
       where gym_id = current_setting('test.gym')::uuid;
     select public.extend_gym_recurrences(
       current_setting('test.gym')::uuid,
       current_setting('test.end')::date + 10) $$,
  'a later schedule edit re-walks cleanly'
);

select is(
  (select count(*)::int from public.class_sessions
    where gym_id = current_setting('test.gym')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date
      and starts_at::time = '10:00'),
  0,
  'no original-time classes came back inside the window'
);

select * from finish();
rollback;
