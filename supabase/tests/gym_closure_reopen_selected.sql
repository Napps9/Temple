-- Reopening some of the classes keeps the closure live. The ticked slots
-- come back; the unticked ones stay gone AND stay blocked, which is the
-- whole point of not lifting the closure — "open gym on the 28th, still
-- shut otherwise" has to hold against classes created later too.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@reopensel.test');
  v_gym     uuid := _test_mk_gym('Reopen Some', 'reopensel');
  v_ct      uuid;
  v_rec     uuid;
  v_start   date := current_date + 10;
  v_end     date := current_date + 16;
  v_result  jsonb;
  v_closure uuid;
  v_exclude jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Reopenable', '#2563EB')
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

  v_result := public.close_gym_dates(v_gym, v_start, v_end, 'Shut', null::uuid[]);
  v_closure := (v_result ->> 'closure_id')::uuid;

  -- Hold back everything except the first two days of the window.
  select jsonb_agg(jsonb_build_object(
           'recurrence_id', p.recurrence_id,
           'starts_at',     p.starts_at))
    into v_exclude
  from (
    select * from public.preview_closure_reopen(v_closure)
    offset 2
  ) p;

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.closure', v_closure::text, true);
  perform set_config('test.start',   v_start::text,   true);
  perform set_config('test.end',     v_end::text,     true);
  perform set_config('test.exclude', v_exclude::text, true);
end;
$$;

select is(
  (select count(*)::int from public.preview_closure_reopen(
     current_setting('test.closure')::uuid)),
  7,
  'the preview lists every class the closure took out'
);

select is(
  ((select public.reopen_closure(
      current_setting('test.closure')::uuid,
      current_setting('test.exclude')::jsonb)) ->> 'restored')::int,
  2,
  'only the ticked classes are restored'
);

-- Deliberately the same call again: it must report the closure still live
-- and restore nothing the second time round.
select results_eq(
  $$ select (public.reopen_closure(
       current_setting('test.closure')::uuid,
       current_setting('test.exclude')::jsonb)) $$,
  $$ values ('{"lifted": false, "restored": 0}'::jsonb) $$,
  'the closure stays live, and re-running restores nothing'
);

select is(
  (select count(*)::int from public.class_sessions
    where gym_id = current_setting('test.gym')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date),
  2,
  'the window holds exactly the two reopened classes'
);

-- The closure is still live, so the dates it still covers stay shut
-- against anything new, not just against what it removed.
select throws_ok(
  $$ insert into public.class_sessions (gym_id, name, starts_at, created_by)
     select current_setting('test.gym')::uuid, 'Sneaky',
            (current_setting('test.end')::date::text || ' 09:00')::timestamptz,
            profile_id
     from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid and role = 'owner' $$,
  'P0001',
  null,
  'a new one-off inside the still-closed dates is still refused'
);

-- Re-running with the same exclusions must not duplicate the two that
-- came back: preview_closure_reopen drops slots that already hold a class.
select is(
  (select count(*)::int from public.preview_closure_reopen(
     current_setting('test.closure')::uuid)),
  5,
  'the reopened classes drop out of the preview'
);

select * from finish();
rollback;
