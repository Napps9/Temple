-- count_open_staff_alerts (0092) — feeds the nav badge total so staff
-- can see there's an open PAR-Q/injury alert waiting, not just from
-- inside the Inbox's Alerts tab.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@openalerts.test');
  v_coach  uuid := _test_mk_user('coach@openalerts.test');
  v_member uuid := _test_mk_user('m@openalerts.test');
  v_gym    uuid := _test_mk_gym('Open Alerts Gym', 'open-alerts');
  v_inj    uuid;
  v_alert  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  perform _test_act_as(v_member);
  v_inj := log_injury(v_gym, 'shoulder', 'left', 'twinge on press', 4,
    '{overhead press}', '{squat}', current_date);

  select id into v_alert from public.staff_alerts
    where kind = 'injury_new' and related_id = v_inj;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.alert', v_alert::text, true);
end $$;

-- 1. The coach sees one open alert.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select is(
  (select count_open_staff_alerts(current_setting('test.gym')::uuid)),
  1,
  'the coach sees one open staff alert after the injury log'
);

-- 2. A bare member (no can_see_health_flag) is refused.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select count_open_staff_alerts(%L::uuid)', current_setting('test.gym')),
  '%Not authorised%',
  'a bare member cannot read the open staff alert count'
);

-- 3. The coach acknowledges the alert.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select lives_ok(
  format('select acknowledge_staff_alert(%L::uuid)', current_setting('test.alert')),
  'the coach can acknowledge the alert'
);

-- 4. The count drops back to zero.
select is(
  (select count_open_staff_alerts(current_setting('test.gym')::uuid)),
  0,
  'the count is zero once the alert is acknowledged'
);

select * from finish();
rollback;
