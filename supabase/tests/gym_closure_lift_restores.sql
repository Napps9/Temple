-- Reopening a closure puts the recurring classes back, and does not
-- resurrect the bookings — those members were refunded and have to book
-- again. The closure row survives, marked lifted.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@lift.test');
  v_member uuid := _test_mk_user('m@lift.test');
  v_gym    uuid := _test_mk_gym('Lift Gym', 'lift');
  v_ct     uuid;
  v_rec    uuid;
  v_start  date := (current_date + 10);
  v_end    date := (current_date + 20);
  v_sess   uuid;
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Restorable', '#2563EB')
    returning id into v_ct;

  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes, capacity,
     starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[0,1,2,3,4,5,6], array['10:00'], 60, 12,
     current_date + 1, 'UTC', v_owner)
  returning id into v_rec;

  -- Only the jwt claim, not the role: extend_recurrence's user_belongs_to
  -- check reads auth.uid(), while the fixture booking below still needs to
  -- bypass RLS. _test_act_as switches the role too and cannot be reliably
  -- undone inside a DO block.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform public.extend_recurrence(v_rec, v_end + 5);

  select id into v_sess from public.class_sessions
    where recurrence_id = v_rec and starts_at::date = v_start;
  perform _test_mk_booking(v_sess, v_member);

  perform _test_act_as(v_owner);
  v_result := public.close_gym_dates(v_gym, v_start, v_end, 'Shut', null::uuid[]);
  perform set_config('test.closure',
    (v_result ->> 'closure_id'), true);
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.rec',   v_rec::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform set_config('test.end',   v_end::text,   true);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date),
  0,
  'the window is empty while the closure is live'
);

select ok(
  (select public.lift_gym_closure(current_setting('test.closure')::uuid)) > 0,
  'lifting reports the classes it put back'
);

select is(
  (select count(*)::int from public.class_sessions
    where recurrence_id = current_setting('test.rec')::uuid
      and starts_at::date between current_setting('test.start')::date
                              and current_setting('test.end')::date),
  11,
  'every day of the reopened window is on the calendar again'
);

select is(
  (select count(*)::int from public.class_bookings
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'bookings are not restored — the member has to book again'
);

select * from finish();
rollback;
