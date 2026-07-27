-- The standing half of a closure. A recurrence materialising across a live
-- closure creates nothing inside it and does NOT abort — the rest of the
-- run has to keep going. A human adding a one-off gets told why instead.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@suppress.test');
  v_gym    uuid := _test_mk_gym('Suppress Gym', 'suppress');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := (current_date + 10);
  v_end    date := (current_date + 20);
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Suppressed', '#2563EB')
    returning id into v_ct;

  -- Every day at 10:00 from tomorrow, so the series straddles the window.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.rec',   v_rec::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform set_config('test.end',   v_end::text,   true);

  perform _test_act_as(v_owner);
  perform public.close_gym_dates(v_gym, v_start, v_end, 'Shut', null::uuid[]);

  -- close_gym_dates materialised out to the window end, so a plain extend
  -- would start past it and prove nothing. Rewind the cursor so the next
  -- walk genuinely crosses the closed dates.
  update public.class_recurrences
    set materialized_until = current_date where id = v_rec;
end;
$$;

select lives_ok(
  $$ select public.extend_recurrence(
       current_setting('test.rec')::uuid,
       (current_setting('test.end')::date + 30)) $$,
  'materialising across a closure does not raise'
);

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date),
  0,
  'no sessions were created inside the closure'
);

select isnt(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date > current_setting('test.end')::date),
  0,
  'the rest of the run past the closure still materialised'
);

select throws_ok(
  $$ insert into public.class_sessions
       (gym_id, name, starts_at, created_by)
     values (
       current_setting('test.gym')::uuid, 'One-off',
       (current_setting('test.start')::date::text || ' 09:00')::timestamptz,
       current_setting('test.owner')::uuid) $$,
  'P0001',
  null,
  'a one-off class inside the closure is refused with an explanation'
);

select * from finish();
rollback;
