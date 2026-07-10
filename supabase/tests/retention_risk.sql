-- Retention cockpit (0122): compute_retention_risk composes the Phase 1
-- signals into scored rows with reason codes, and compute_retention_summary
-- gives the cheap counts. A healthy member never appears; the scorer is gated
-- on can_see_retention.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@risk.test');
  v_coach uuid := _test_mk_user('coach@risk.test');
  v_pd    uuid := _test_mk_user('pastdue@risk.test');   -- past_due
  v_decay uuid := _test_mk_user('decay@risk.test');     -- attendance drop
  v_ok    uuid := _test_mk_user('healthy@risk.test');   -- no signals
  v_gym   uuid := _test_mk_gym('Risk Gym', 'risk-gym');
  v_plan  uuid;
  v_ct    uuid;
  v_s     uuid;
  v_d     int;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_pd,    'member');
  perform _test_mk_membership(v_gym, v_decay, 'member');
  perform _test_mk_membership(v_gym, v_ok,    'member');

  insert into public.membership_plans (gym_id, name, kind)
  values (v_gym, 'Unlimited', 'unlimited') returning plan_id into v_plan;
  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'WOD', '#2563EB') returning id into v_ct;

  -- past_due member: a failing renewal.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_pd, v_gym, v_plan, 'past_due'::public.plan_sub_state, now() - interval '2 days'
  from public.gym_memberships where gym_id = v_gym and profile_id = v_pd;

  -- healthy member: active sub, far-future renewal.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_ok, v_gym, v_plan, 'active'::public.plan_sub_state, now() + interval '40 days'
  from public.gym_memberships where gym_id = v_gym and profile_id = v_ok;

  -- Attendance: 5 baseline sessions (14..84d back) for both decay + healthy;
  -- healthy also attends twice recently (cadence ~1.0, no decay), decay does
  -- not (cadence 0, => attendance_decay).
  foreach v_d in array array[20, 30, 40, 50, 60] loop
    v_s := _test_mk_session(v_gym, v_coach, now() - make_interval(days => v_d), 60, v_ct);
    perform _test_mk_booking(v_s, v_decay);
    update public.class_bookings set attended_at = now() - make_interval(days => v_d), marked_by = v_coach
      where class_session_id = v_s and profile_id = v_decay;
    perform _test_mk_booking(v_s, v_ok);
    update public.class_bookings set attended_at = now() - make_interval(days => v_d), marked_by = v_coach
      where class_session_id = v_s and profile_id = v_ok;
  end loop;
  foreach v_d in array array[3, 8] loop
    v_s := _test_mk_session(v_gym, v_coach, now() - make_interval(days => v_d), 60, v_ct);
    perform _test_mk_booking(v_s, v_ok);
    update public.class_bookings set attended_at = now() - make_interval(days => v_d), marked_by = v_coach
      where class_session_id = v_s and profile_id = v_ok;
  end loop;

  perform _test_act_as(v_owner);
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.pd',    v_pd::text,    true);
  perform set_config('test.decay', v_decay::text, true);
  perform set_config('test.ok',    v_ok::text,    true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

-- 1. past_due member is flagged with the past_due reason.
select ok(
  (select 'past_due' = any(reasons) from public.compute_retention_risk(current_setting('test.gym')::uuid)
   where member_id = current_setting('test.pd')::uuid),
  'past_due member is flagged with a past_due reason');

-- 2. decaying member is flagged with attendance_decay.
select ok(
  (select 'attendance_decay' = any(reasons) from public.compute_retention_risk(current_setting('test.gym')::uuid)
   where member_id = current_setting('test.decay')::uuid),
  'decaying member is flagged with attendance_decay');

-- 3. healthy member does not appear.
select is(
  (select count(*)::int from public.compute_retention_risk(current_setting('test.gym')::uuid)
   where member_id = current_setting('test.ok')::uuid),
  0,
  'a member with no signals is not in the at-risk list');

-- 4. past_due carries a positive score.
select ok(
  (select risk_score > 0 from public.compute_retention_risk(current_setting('test.gym')::uuid)
   where member_id = current_setting('test.pd')::uuid),
  'the past_due member has a positive risk score');

-- 5-7. Summary counts.
select is(
  (select past_due from public.compute_retention_summary(current_setting('test.gym')::uuid)),
  1, 'summary: one past_due member');
select is(
  (select at_risk from public.compute_retention_summary(current_setting('test.gym')::uuid)),
  2, 'summary: two at-risk members (past_due + decay), healthy excluded');
select is(
  (select winback from public.compute_retention_summary(current_setting('test.gym')::uuid)),
  0, 'summary: no win-back candidates in this gym');

-- 8. A non-retention role is refused.
do $$ begin perform _test_act_as(current_setting('test.pd')::uuid); end $$;
select throws_ok(
  $$ select * from public.compute_retention_risk(current_setting('test.gym')::uuid) $$,
  'Not authorised',
  'a plain member cannot run the retention scorer');

select * from finish();
rollback;
