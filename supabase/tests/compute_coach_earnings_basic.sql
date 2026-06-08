-- compute_coach_earnings returns one row per class type with a non-
-- zero count or a configured rate. Earnings = count × rate_cents.
-- The 'all_scheduled' policy counts every past session with
-- coach_id = coach in the period.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@earn.test');
  v_coach uuid := _test_mk_user('coach@earn.test');
  v_gym   uuid := _test_mk_gym('Earnings Gym', 'earnings-gym');
  v_ct_a  uuid;
  v_ct_b  uuid;
  v_ct_c  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#FF0000') returning id into v_ct_a;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Open Gym', '#00FF00') returning id into v_ct_b;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Hyrox', '#0000FF') returning id into v_ct_c;

  -- Past sessions: 3 CrossFit + 2 Open Gym (all credited).
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values
    (v_gym, 'A1', v_coach, now() - interval '5 days',  60, 12, v_owner, v_ct_a),
    (v_gym, 'A2', v_coach, now() - interval '7 days',  60, 12, v_owner, v_ct_a),
    (v_gym, 'A3', v_coach, now() - interval '9 days',  60, 12, v_owner, v_ct_a),
    (v_gym, 'B1', v_coach, now() - interval '6 days',  60, 12, v_owner, v_ct_b),
    (v_gym, 'B2', v_coach, now() - interval '8 days',  60, 12, v_owner, v_ct_b);

  -- A future session that should NOT count.
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values (v_gym, 'Future', v_coach, now() + interval '2 days', 60, 12, v_owner, v_ct_a);

  -- Rates: CrossFit £25, Open Gym £15, Hyrox £30 (no classes taught).
  insert into public.coach_pay_rates
    (gym_id, profile_id, class_type_id, per_class_cents)
  values
    (v_gym, v_coach, v_ct_a, 2500),
    (v_gym, v_coach, v_ct_b, 1500),
    (v_gym, v_coach, v_ct_c, 3000);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- Coach can compute their own earnings.
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
  5,
  'total class_count across types is 5 (the future class is excluded)'
);

select is(
  (select sum(earnings_cents)::int from public.compute_coach_earnings(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    now() - interval '14 days',
    now() + interval '1 day'
  ))::int,
  3 * 2500 + 2 * 1500,
  'earnings = 3 CrossFit × £25 + 2 Open Gym × £15 = £105'
);

-- Hyrox row appears even though the coach taught 0 — rate is set.
select is(
  (select class_count::int from public.compute_coach_earnings(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    now() - interval '14 days',
    now() + interval '1 day'
  ) where class_type_name = 'Hyrox'),
  0,
  'Hyrox row appears with 0 classes when a rate is configured but no classes taught'
);

-- Owner can compute earnings for the coach.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
end;
$$;

select is(
  (select sum(earnings_cents)::int from public.compute_coach_earnings(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    now() - interval '14 days',
    now() + interval '1 day'
  ))::int,
  3 * 2500 + 2 * 1500,
  'owner can compute another coach''s earnings'
);

select * from finish();
rollback;
