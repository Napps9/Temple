-- When the window covers a schedule's whole life there is nothing to
-- split — the pattern is simply rewritten, and its materialisation cursor
-- survives. Restoring the cursor matters: the 0078 trigger nulls it on any
-- pattern change so newly ADDED times backfill, but here the times moved
-- and the sessions moved with them, so a re-walk from starts_on would only
-- manufacture past occurrences at the new times.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@recinplace.test');
  v_gym    uuid := _test_mk_gym('In Place', 'recinplace');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := current_date + 10;
  v_end    date := current_date + 16;
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Bounded', '#2563EB')
    returning id into v_ct;

  -- Starts and ends exactly on the window.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, ends_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     v_start, v_end, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_end);

  v_result := public.bulk_edit_sessions(
    v_gym, v_start, v_end, null::uuid[], 20, 45, -30);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.rec',    v_rec::text,    true);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (current_setting('test.result')::jsonb ->> 'recurrences_updated')::int,
  1,
  'the schedule was rewritten in place'
);

select is(
  (select count(*)::int from public.class_recurrences
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'and no extra schedules were created'
);

select results_eq(
  $$ select times, duration_minutes, capacity
       from public.class_recurrences
       where id = current_setting('test.rec')::uuid $$,
  $$ values (array['09:30'], 45, 20) $$,
  'the pattern carries the new time, length and capacity'
);

select isnt(
  (select materialized_until from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  null,
  'the materialisation cursor was restored, not left null by the 0078 trigger'
);

select * from finish();
rollback;
