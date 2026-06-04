-- cancel_recurrence(p_recurrence_id) deletes every future session in the
-- series and the recurrence row, but past sessions stay as history. They
-- survive because class_sessions.recurrence_id has ON DELETE SET NULL —
-- the recurrence vanishes but the past session row remains with
-- recurrence_id = null.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cancelwhole.test');
  v_gym   uuid := _test_mk_gym('Cancel Whole', 'cancelwhole');
  v_ct    uuid;
  v_rec   uuid;
  v_past  uuid;
  v_fut_a uuid;
  v_fut_b uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Mobility', '#10B981')
    returning id into v_ct;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, ends_on, tz, materialized_until, created_by)
  values
    (v_gym, v_ct, ARRAY[3], ARRAY['18:00'], 45, 8,
     (now() - interval '21 days')::date, (now() + interval '90 days')::date,
     'UTC', (now() + interval '90 days')::date, v_owner)
  returning id into v_rec;

  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'past 1', v_owner, now() - interval '14 days', 45, 8, v_owner, v_ct, v_rec)
  returning id into v_past;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'fut a',  v_owner, now() + interval '7 days',  45, 8, v_owner, v_ct, v_rec)
  returning id into v_fut_a;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id, recurrence_id)
  values (v_gym, 'fut b',  v_owner, now() + interval '14 days', 45, 8, v_owner, v_ct, v_rec)
  returning id into v_fut_b;

  perform set_config('test.rec',   v_rec::text,   true);
  perform set_config('test.past',  v_past::text,  true);
  perform set_config('test.fut_a', v_fut_a::text, true);
  perform set_config('test.fut_b', v_fut_b::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_recurrence(v_rec);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where id in (current_setting('test.fut_a')::uuid,
                 current_setting('test.fut_b')::uuid)),
  0,
  'both future sessions deleted'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.past')::uuid),
  1,
  'past session row preserved'
);

select is(
  (select recurrence_id from public.class_sessions
    where id = current_setting('test.past')::uuid),
  null,
  'past session.recurrence_id set to null via ON DELETE SET NULL'
);

select * from finish();
rollback;
