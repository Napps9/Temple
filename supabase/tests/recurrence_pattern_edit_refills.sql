-- Editing a class_recurrences row's times[] or days_of_week resets
-- materialized_until to null (via 0078 trigger), so the next
-- extend_recurrence call refills the missing combinations into
-- already-materialised dates. Existing sessions stay (ON CONFLICT
-- DO NOTHING in the materialiser).

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@refill.test');
  v_gym   uuid := _test_mk_gym('Refill', 'refill');
  v_ct    uuid;
  v_rec   uuid;
  v_today date := current_date;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#2563EB')
    returning id into v_ct;

  -- Start a recurrence with one time. Materialise it forward.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes,
     capacity, starts_on, tz, created_by)
  values
    (v_gym, v_ct, ARRAY[0,1,2,3,4,5,6], ARRAY['09:00'], 60, 12,
     v_today, 'UTC', v_owner)
  returning id into v_rec;

  perform _test_act_as(v_owner);
  perform public.extend_recurrence(v_rec, v_today + 14);

  perform set_config('test.rec', v_rec::text, true);
end;
$$;

-- One time per day → 15 sessions over 15 days.
select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid),
  15,
  '15 sessions materialised for the single 09:00 time over 15 days'
);

-- Edit the recurrence to add a second time. The trigger should null
-- materialized_until.
do $$
begin
  update public.class_recurrences
    set times = ARRAY['09:00', '17:30']
    where id = current_setting('test.rec')::uuid;
end;
$$;

select is(
  (select materialized_until from public.class_recurrences
    where id = current_setting('test.rec')::uuid),
  null,
  'materialized_until nulled by the pattern-change trigger'
);

-- Re-extend through the same horizon. New 17:30 sessions should
-- appear on the historical days that were already materialised.
do $$
begin
  perform _test_act_as(_test_mk_user('caller@refill.test')); -- any caller
  -- Use the owner because user_belongs_to is required by extend.
end;
$$;

do $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner from public.gym_memberships
    where gym_id = (select gym_id from public.class_recurrences
                     where id = current_setting('test.rec')::uuid)
      and role = 'owner'
    limit 1;
  perform _test_act_as(v_owner);
  perform public.extend_recurrence(
    current_setting('test.rec')::uuid,
    current_date + 14
  );
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid),
  30,
  '30 sessions after re-extend: original 09:00 set + new 17:30 set for the same days'
);

-- Sanity: no double-insertion of the 09:00 slot for any single day.
select is(
  (select max(c)::int from (
    select count(*) c from public.class_sessions
      where recurrence_id = current_setting('test.rec')::uuid
      group by starts_at
  ) s),
  1,
  'ON CONFLICT DO NOTHING kept each (recurrence, starts_at) unique'
);

select * from finish();
rollback;
