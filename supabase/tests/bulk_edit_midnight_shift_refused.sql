-- A shift that would push a class past midnight changes which days the
-- pattern fires on, which a same-day shift cannot express. It is refused
-- before anything is applied, so the operator never ends up with half a
-- bulk edit.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@midnight.test');
  v_gym   uuid := _test_mk_gym('Midnight', 'midnight');
  v_ct    uuid;
  v_rec   uuid;
  v_start date := current_date + 10;
  v_end   date := current_date + 16;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Late', '#2563EB')
    returning id into v_ct;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['23:30'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_end + 5);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform set_config('test.end',   v_end::text,   true);
end;
$$;

select throws_ok(
  $$ select public.bulk_edit_sessions(
       current_setting('test.gym')::uuid,
       current_setting('test.start')::date,
       current_setting('test.end')::date,
       null::uuid[], null::int, null::int, 60) $$,
  'P0001',
  null,
  'a shift past midnight is refused'
);

select is(
  (select count(*)::int from public.class_sessions
    where gym_id = current_setting('test.gym')::uuid
      and starts_at::time <> '23:30'),
  0,
  'and no class was moved before the refusal'
);

select lives_ok(
  $$ select public.bulk_edit_sessions(
       current_setting('test.gym')::uuid,
       current_setting('test.start')::date,
       current_setting('test.end')::date,
       null::uuid[], null::int, null::int, -30) $$,
  'a shift that stays inside the day is fine'
);

select * from finish();
rollback;
