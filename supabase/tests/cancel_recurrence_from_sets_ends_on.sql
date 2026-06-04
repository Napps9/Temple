-- cancel_recurrence_from(p_session_id) deletes that session and every
-- future sibling in the same recurrence, then truncates the recurrence
-- by setting class_recurrences.ends_on to the day before. This prevents
-- extend_recurrence / copy_week_forward from re-materialising the
-- cancelled occurrences.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cancelfrom.test');
  v_gym   uuid := _test_mk_gym('Cancel From', 'cancelfrom');
  v_ct    uuid;
  v_rec   uuid;
  v_past  uuid;
  v_target uuid;
  v_fut_a uuid;
  v_fut_b uuid;
  v_target_date date;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#2563EB')
    returning id into v_ct;

  -- Recurrence with ends_on = far future so it isn't already past.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, ends_on, tz, materialized_until, created_by)
  values
    (v_gym, v_ct, ARRAY[1], ARRAY['10:00'], 60, 12,
     (now() - interval '14 days')::date, (now() + interval '60 days')::date,
     'UTC', (now() + interval '60 days')::date, v_owner)
  returning id into v_rec;

  -- One past + one current target + two future siblings, all in the same rec.
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'S past', v_owner, now() - interval '7 days', 60, 12, v_owner, v_ct, v_rec)
  returning id into v_past;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'S target', v_owner, now() + interval '7 days', 60, 12, v_owner, v_ct, v_rec)
  returning id into v_target;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'S fut a', v_owner, now() + interval '14 days', 60, 12, v_owner, v_ct, v_rec)
  returning id into v_fut_a;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'S fut b', v_owner, now() + interval '21 days', 60, 12, v_owner, v_ct, v_rec)
  returning id into v_fut_b;

  v_target_date := ((now() + interval '7 days')::date - interval '1 day')::date;

  perform set_config('test.rec',    v_rec::text,            true);
  perform set_config('test.past',   v_past::text,           true);
  perform set_config('test.fut_b',  v_fut_b::text,          true);
  perform set_config('test.target_date', v_target_date::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_recurrence_from(v_target);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at > now()),
  0,
  'no future siblings remain in the recurrence'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.past')::uuid),
  1,
  'past sibling preserved (history not touched)'
);

select is(
  (select ends_on from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  current_setting('test.target_date')::date,
  'recurrence ends_on set to the day before the target session'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.fut_b')::uuid),
  0,
  'farthest future sibling deleted (was after the target)'
);

select * from finish();
rollback;
