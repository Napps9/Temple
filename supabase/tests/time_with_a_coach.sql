-- 0276: appointments as capacity-1 class sessions. What is free, what
-- taking one does, and that it is not a way round any booking gate.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@appt.test');
  v_coach uuid := _test_mk_user('coach@appt.test');
  v_mem   uuid := _test_mk_user('mem@appt.test');
  v_gym   uuid := _test_mk_gym('Appt Gym', 'appt-gym');
  v_ct    uuid;
  v_class uuid;
  v_next  date;
  v_out   uuid := _test_mk_user('outsider@appt.test');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_mem, 'member');
  update public.gyms set timezone = 'UTC', require_membership_to_book = false
   where id = v_gym;

  insert into public.class_types (gym_id, name, color, is_appointment, appointment_minutes)
  values (v_gym, 'Intro consult', '#7C3AED', true, 30) returning id into v_ct;
  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'CrossFit', '#C2410C') returning id into v_class;

  -- Seven days out, so the weekday always has a future date in range.
  v_next := (now() at time zone 'UTC')::date + 7;
  insert into public.coach_availability
    (gym_id, coach_id, class_type_id, day_of_week, starts_at, ends_at)
  values (v_gym, v_coach, v_ct, extract(dow from v_next)::int, '09:00', '11:00');

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ct', v_ct::text, false);
  perform set_config('test.class', v_class::text, false);
  perform set_config('test.coach', v_coach::text, false);
  perform set_config('test.mem', v_mem::text, false);
  perform set_config('test.day', v_next::text, false);
  perform set_config('test.out', v_out::text, false);
end $$;

-- 1. Two hours in thirty-minute slots is four.
select _test_act_as(current_setting('test.mem')::uuid);
select is(
  (select count(*)::int from public.appointment_slots(
     current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
     current_setting('test.day')::date, current_setting('test.day')::date)),
  4,
  'a two-hour window in half-hours offers four slots'
);

-- 2. A class type is not an appointment type.
select is(
  (select count(*)::int from public.appointment_slots(
     current_setting('test.gym')::uuid, current_setting('test.class')::uuid,
     current_setting('test.day')::date, current_setting('test.day')::date)),
  0,
  'an ordinary class type offers none'
);

-- 3. The range is bounded — a standing weekly pattern would otherwise
--    expand for as long as somebody typed.
select throws_ok(
  format($q$select * from public.appointment_slots(%L, %L, %L, %L)$q$,
    current_setting('test.gym'), current_setting('test.ct'),
    current_setting('test.day'), (current_setting('test.day')::date + 400)),
  'Ask for a range of up to two months',
  'an unbounded range is refused'
);

-- 4-5. Booking one creates the session and the booking together.
do $$
declare v_slot timestamptz;
begin
  select starts_at into v_slot from public.appointment_slots(
    current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
    current_setting('test.day')::date, current_setting('test.day')::date)
  order by starts_at limit 1;
  perform set_config('test.slot', v_slot::text, false);
end $$;

select isnt(
  (select public.book_appointment(
     current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
     current_setting('test.coach')::uuid, current_setting('test.slot')::timestamptz)),
  null,
  'a member takes a slot'
);
select is(
  (select capacity from public.class_sessions
    where class_type_id = current_setting('test.ct')::uuid),
  1,
  'and the session it created holds exactly one person'
);

-- 6. That slot is gone from what is free.
select is(
  (select count(*)::int from public.appointment_slots(
     current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
     current_setting('test.day')::date, current_setting('test.day')::date)),
  3,
  'a taken slot stops being offered'
);

-- 7. A time nobody published is refused, whatever the caller sends.
select throws_ok(
  format($q$select public.book_appointment(%L, %L, %L, %L)$q$,
    current_setting('test.gym'), current_setting('test.ct'),
    current_setting('test.coach'),
    (current_setting('test.slot')::timestamptz + interval '5 hours')),
  'That time is not available',
  'a made-up time is refused rather than materialised'
);

-- 8. Slots are computed, never written ahead: three free slots are three
--    rows that do not exist, not three phantom classes in the timetable.
select is(
  (select count(*)::int from public.class_sessions
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'only the booked slot exists as a session'
);

-- 9. Nobody outside the gym can read what is free.
select _test_act_as(current_setting('test.out')::uuid);
select throws_ok(
  format($q$select * from public.appointment_slots(%L, %L, %L, %L)$q$,
    current_setting('test.gym'), current_setting('test.ct'),
    current_setting('test.day'), current_setting('test.day')),
  'Not authorised',
  'availability is not public'
);

select * from finish();
rollback;
