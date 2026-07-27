-- The path that actually bit: the class-types editor's save
-- (class-types.tsx) deletes every future session of a schedule and
-- re-extends from the pattern. Before 0170 a shift lived only on the
-- sessions, so that rebuild silently reverted it. Now the pattern owns the
-- shifted times and the rebuild reproduces them.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@rebuild.test');
  v_gym   uuid := _test_mk_gym('Rebuild', 'rebuild');
  v_ct    uuid;
  v_rec   uuid;
  v_start date := current_date + 10;
  v_end   date := current_date + 16;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Rebuilt', '#2563EB')
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
  perform public.bulk_edit_sessions(
    v_gym, v_start, v_end, null::uuid[], null::int, null::int, 60);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform set_config('test.end',   v_end::text,   true);
end;
$$;

-- Exactly what the editor does on save: wipe the future, rewind the
-- cursor, re-extend.
select lives_ok(
  $$ delete from public.class_sessions
       where gym_id = current_setting('test.gym')::uuid
         and starts_at >= now();
     update public.class_recurrences
       set materialized_until = current_date
       where gym_id = current_setting('test.gym')::uuid;
     select public.extend_gym_recurrences(
       current_setting('test.gym')::uuid,
       current_setting('test.end')::date + 5) $$,
  'the schedule rebuild runs'
);

select is(
  (select count(distinct starts_at::time)::int || ':'
          || count(*)::int
     from public.class_sessions
     where gym_id = current_setting('test.gym')::uuid
       and starts_at::date between current_setting('test.start')::date
                               and current_setting('test.end')::date),
  '1:7',
  'the window rebuilt as seven classes at one time, not fourteen at two'
);

select is(
  (select distinct starts_at::time from public.class_sessions
     where gym_id = current_setting('test.gym')::uuid
       and starts_at::date between current_setting('test.start')::date
                               and current_setting('test.end')::date),
  '11:00'::time,
  'and that time is the shifted one'
);

select * from finish();
rollback;
