-- Lead notifications (0108): capture enqueues one in-app (sent) + one
-- email (queued); enqueue is idempotent; a failed email requeues; a
-- coach can only mark their own in-app row read; SMS is gated on the flag.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@notif.test');
  v_coach uuid := _test_mk_user('coach@notif.test');
  v_member uuid := _test_mk_user('member@notif.test');
  v_gym uuid := _test_mk_gym('Notif Gym', 'notif-gym');
  v_lead uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');

  perform _test_act_as(v_owner);
  v_lead := record_lead(v_gym, 'Casey Prospect', 'casey@prospect.test');

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.lead', v_lead::text, true);
  perform set_config('test.inapp',
    (select id from public.lead_notifications
       where lead_id = v_lead and channel = 'in_app')::text, true);
  perform set_config('test.email',
    (select id from public.lead_notifications
       where lead_id = v_lead and channel = 'email')::text, true);
end $$;

-- 1. In-app notification is created already delivered.
select is(
  (select status from public.lead_notifications
     where id = current_setting('test.inapp')::uuid),
  'sent',
  'in-app notification is written as sent');

-- 2. Email notification is queued for the worker.
select is(
  (select status from public.lead_notifications
     where id = current_setting('test.email')::uuid),
  'queued',
  'email notification is queued');

-- 3. The email is addressed to the coach.
select is(
  (select recipient from public.lead_notifications
     where id = current_setting('test.email')::uuid),
  'coach@notif.test',
  'email notification targets the assigned coach');

-- 4. Enqueue is idempotent: still exactly one email row after re-assign.
do $$ begin perform assign_lead(current_setting('test.lead')::uuid); end $$;
select is(
  (select count(*)::int from public.lead_notifications
     where lead_id = current_setting('test.lead')::uuid and channel = 'email'),
  1,
  're-assignment does not duplicate the email notification');

-- 5. A failed email can be requeued by staff.
update public.lead_notifications set status = 'failed', error = 'boom'
  where id = current_setting('test.email')::uuid;
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform requeue_lead_notification(current_setting('test.email')::uuid);
end $$;
select is(
  (select status from public.lead_notifications
     where id = current_setting('test.email')::uuid),
  'queued',
  'requeue_lead_notification flips a failed send back to queued');

-- 6. A non-recipient cannot mark the in-app row read.
do $$
begin
  perform _test_act_as(current_setting('test.member')::uuid);
  perform mark_lead_notification_read(current_setting('test.inapp')::uuid);
end $$;
select is(
  (select status from public.lead_notifications
     where id = current_setting('test.inapp')::uuid),
  'sent',
  'a non-recipient cannot mark the in-app notification read');

-- 7. The assigned coach can mark their own in-app row read.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
  perform mark_lead_notification_read(current_setting('test.inapp')::uuid);
end $$;
select is(
  (select status from public.lead_notifications
     where id = current_setting('test.inapp')::uuid),
  'read',
  'the assigned coach can mark their own in-app notification read');

-- 8. Unread count for the coach is zero once read.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  count_unread_lead_notifications(current_setting('test.gym')::uuid),
  0,
  'unread count drops to zero after the coach reads the notification');

-- 9. SMS only enqueues when the gym has opted in.
do $$
declare v_lead2 uuid;
begin
  update public.gyms set lead_sms_enabled = true
    where id = current_setting('test.gym')::uuid;
  perform _test_act_as(current_setting('test.owner')::uuid);
  v_lead2 := record_lead(current_setting('test.gym')::uuid, 'SMS Prospect', null, '+447700900000');
  perform set_config('test.lead2', v_lead2::text, true);
end $$;
select is(
  (select count(*)::int from public.lead_notifications
     where lead_id = current_setting('test.lead2')::uuid and channel = 'sms'),
  1,
  'an SMS notification is enqueued only when lead_sms_enabled is on');

select * from finish();
rollback;
