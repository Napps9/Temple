-- The 'only_checked_in' policy excludes classes where the coach didn't
-- mark any booking attendance (attended_at or no_show).

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@checkin.test');
  v_coach uuid := _test_mk_user('coach@checkin.test');
  v_mem   uuid := _test_mk_user('mem@checkin.test');
  v_gym   uuid := _test_mk_gym('Check-in Earn', 'checkin-earn');
  v_ct    uuid;
  v_s1    uuid;
  v_s2    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_mem,   'member');

  -- Flip the gym policy to only_checked_in.
  update public.gyms set coach_credit_policy = 'only_checked_in' where id = v_gym;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#FF0000') returning id into v_ct;

  -- Two past sessions: one where the coach checked someone in, one
  -- where they didn't.
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values (v_gym, 'Checked', v_coach, now() - interval '3 days', 60, 12, v_owner, v_ct)
  returning id into v_s1;

  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values (v_gym, 'NoMark', v_coach, now() - interval '5 days', 60, 12, v_owner, v_ct)
  returning id into v_s2;

  -- A booking marked attended_at by the coach on s1; no booking marks on s2.
  insert into public.class_bookings
    (gym_id, class_session_id, profile_id, attended_at, marked_by)
  values
    (v_gym, v_s1, v_mem, now() - interval '3 days', v_coach);

  insert into public.coach_pay_rates
    (gym_id, profile_id, class_type_id, per_class_cents)
  values (v_gym, v_coach, v_ct, 2500);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select sum(class_count)::int from public.compute_coach_earnings(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    now() - interval '14 days',
    now() + interval '1 day'
  ))::int,
  1,
  'only_checked_in credits the session where the coach marked attendance'
);

select is(
  (select sum(earnings_cents)::int from public.compute_coach_earnings(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    now() - interval '14 days',
    now() + interval '1 day'
  ))::int,
  2500,
  'earnings = 1 credited class × £25 = £25'
);

select * from finish();
rollback;
