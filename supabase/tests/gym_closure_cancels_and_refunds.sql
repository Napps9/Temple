-- close_gym_dates cancels every future class inside the window, refunds
-- the members who had booked, and leaves an unticked class alone.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@closure.test');
  v_member  uuid := _test_mk_user('m@closure.test');
  v_gym     uuid := _test_mk_gym('Closure Gym', 'closure');
  v_mid     uuid;
  v_plan    uuid;
  v_sub     uuid;
  v_start   date := (current_date + 10);
  v_end     date := (current_date + 20);
  v_inside  uuid;
  v_kept    uuid;
  v_outside uuid;
  v_result  jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count, period_length)
    values (v_gym, 'Ten-pack', 'credit_period', 10, interval '30 days')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 9)
  returning id into v_sub;

  v_inside  := _test_mk_session(v_gym, v_owner, (v_start::text || ' 10:00')::timestamptz);
  v_kept    := _test_mk_session(v_gym, v_owner, (v_start::text || ' 18:00')::timestamptz);
  v_outside := _test_mk_session(v_gym, v_owner, ((v_end + 3)::text || ' 10:00')::timestamptz);

  perform _test_mk_booking(v_inside, v_member);

  perform set_config('test.sub',     v_sub::text,     true);
  perform set_config('test.inside',  v_inside::text,  true);
  perform set_config('test.kept',    v_kept::text,    true);
  perform set_config('test.outside', v_outside::text, true);

  perform _test_act_as(v_owner);
  v_result := public.close_gym_dates(
    v_gym, v_start, v_end, 'Christmas closure', array[v_kept]);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.inside')::uuid),
  0,
  'a class inside the window is cancelled'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.kept')::uuid),
  1,
  'an excluded class inside the window survives'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.outside')::uuid),
  1,
  'a class outside the window is untouched'
);

select is(
  (select credit_balance from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  10,
  'the booked member gets their credit back'
);

select is(
  (current_setting('test.result')::jsonb ->> 'cancelled')::int,
  1,
  'the result reports one cancellation'
);

select * from finish();
rollback;
