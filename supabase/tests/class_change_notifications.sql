-- Closing the gym tells the members who had booked: one in-app row and
-- one email row each, never one per class. A blanket unsubscribe
-- suppresses the email (recorded 'skipped', so it stays visible) but
-- never the in-app row.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@classnotif.test');
  v_keen   uuid := _test_mk_user('keen@classnotif.test');
  v_quiet  uuid := _test_mk_user('quiet@classnotif.test');
  v_gym    uuid := _test_mk_gym('Notif Gym', 'classnotif');
  v_start  date := (current_date + 10);
  v_end    date := (current_date + 20);
  v_one    uuid;
  v_two    uuid;
  v_result jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_keen,  'member');
  perform _test_mk_membership(v_gym, v_quiet, 'member');

  -- Blanket unsubscribe: topic_id null means "send me nothing".
  insert into public.email_unsubscribes (gym_id, email, topic_id)
    values (v_gym, 'quiet@classnotif.test', null);

  v_one := _test_mk_session(v_gym, v_owner, (v_start::text || ' 10:00')::timestamptz);
  v_two := _test_mk_session(v_gym, v_owner, (v_start::text || ' 18:00')::timestamptz);

  -- Two classes for the same member: still one notification.
  perform _test_mk_booking(v_one, v_keen);
  perform _test_mk_booking(v_two, v_keen);
  perform _test_mk_booking(v_one, v_quiet);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.keen',  v_keen::text,  true);
  perform set_config('test.quiet', v_quiet::text, true);

  perform _test_act_as(v_owner);
  v_result := public.close_gym_dates(v_gym, v_start, v_end, 'Christmas', null::uuid[]);
  perform set_config('test.result', v_result::text, true);
end;
$$;

select is(
  (select count(*)::int from public.class_change_notifications
    where gym_id = current_setting('test.gym')::uuid
      and recipient_profile_id = current_setting('test.keen')::uuid),
  2,
  'a member booked into two cancelled classes gets one in-app + one email, not four'
);

select is(
  (select status from public.class_change_notifications
    where recipient_profile_id = current_setting('test.keen')::uuid
      and channel = 'email'),
  'queued',
  'the email is queued for the worker'
);

select is(
  (select status from public.class_change_notifications
    where recipient_profile_id = current_setting('test.quiet')::uuid
      and channel = 'email'),
  'skipped',
  'a blanket unsubscribe skips the email, visibly'
);

select is(
  (select status from public.class_change_notifications
    where recipient_profile_id = current_setting('test.quiet')::uuid
      and channel = 'in_app'),
  'sent',
  'but never the in-app notification'
);

select is(
  (current_setting('test.result')::jsonb ->> 'notified')::int,
  2,
  'the result counts members told, not rows written'
);

select * from finish();
rollback;
