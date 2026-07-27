-- Invariant: requesting cover notifies the coaches who could claim it,
-- and claiming notifies the coach who asked.
--
-- The digest rule is the load-bearing one: ONE cover_requested
-- notification per recipient per REQUEST, however many classes the
-- request covers. A per-class fan-out would mean twenty emails per coach
-- for a fortnight's cover.

-- Assertions run as the owner: cover_notifications is RLS'd to
-- "your own rows, or an admin's view of the gym", so a coach reading
-- another coach's notifications legitimately sees nothing. Test 10 pins
-- that directly.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covnotif.test');
  v_coach_a uuid := _test_mk_user('coach_a@covnotif.test');   -- requester
  v_coach_b uuid := _test_mk_user('coach_b@covnotif.test');   -- can claim
  v_member  uuid := _test_mk_user('member@covnotif.test');    -- must not hear
  v_gym     uuid := _test_mk_gym('Notif Gym', 'covnotif');
  v_start   date := (current_date + 5);
  v_end     date := (current_date + 8);
  v_ct      uuid;
  v_one     uuid;
  v_two     uuid;
  v_three   uuid;
  v_request uuid;
  v_offer   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');
  perform _test_mk_membership(v_gym, v_member,  'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Notif Test', '#F97316')
    returning id into v_ct;

  v_one := _test_mk_session(v_gym, v_coach_a,
    (v_start::text || ' 06:00')::timestamp at time zone 'UTC', 60, v_ct);
  v_two := _test_mk_session(v_gym, v_coach_a,
    ((v_start + 1)::text || ' 06:00')::timestamp at time zone 'UTC', 60, v_ct);
  v_three := _test_mk_session(v_gym, v_coach_a,
    (v_end::text || ' 06:00')::timestamp at time zone 'UTC', 60, v_ct);

  perform _test_act_as(v_coach_a);
  v_request := request_cover_range(v_gym, v_start, v_end, null::uuid[], null::text);

  select id into v_offer from public.cover_request_sessions
    where request_id = v_request and class_session_id = v_two;

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.offer',   v_offer::text,   true);
  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.coach_a', v_coach_a::text, true);
  perform set_config('test.coach_b', v_coach_b::text, true);
  perform set_config('test.member',  v_member::text,  true);
  perform set_config('test.owner',   v_owner::text,   true);

  perform _test_act_as(v_owner);
end;
$$;

-- 1. Three classes, but coach B gets exactly one in-app notification.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and kind = 'cover_requested'
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.coach_b')::uuid),
  1,
  'one in-app digest per recipient per request, not one per class'
);

-- 2. And exactly one email row.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and kind = 'cover_requested'
       and channel = 'email'
       and recipient_profile_id = current_setting('test.coach_b')::uuid),
  1,
  'one email row per recipient per request'
);

-- 3. The owner can claim too, so the owner is notified.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.owner')::uuid),
  1,
  'the owner is notified — user_can_cover includes them'
);

-- 4. The requester is not told about their own request.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and kind = 'cover_requested'
       and recipient_profile_id = current_setting('test.coach_a')::uuid),
  0,
  'the requester is not notified about their own request'
);

-- 5. Members cannot claim cover, so they are never notified.
select is(
  (select count(*)::int from public.cover_notifications
     where recipient_profile_id = current_setting('test.member')::uuid),
  0,
  'members are not notified about cover'
);

-- 6. The in-app half is delivered immediately; email waits for the worker.
select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.coach_b')::uuid),
  'sent',
  'the in-app row IS the notification — delivered on insert'
);

select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'email'
       and recipient_profile_id = current_setting('test.coach_b')::uuid),
  'queued',
  'the email row is queued for the edge worker'
);

-- 7. Claiming notifies the requester, keyed on the offer.
do $$
begin
  perform _test_act_as(current_setting('test.coach_b')::uuid);
  perform claim_cover(current_setting('test.offer')::uuid);
  perform _test_act_as(current_setting('test.owner')::uuid);
end;
$$;

select is(
  (select count(*)::int from public.cover_notifications
     where offer_id = current_setting('test.offer')::uuid
       and kind = 'cover_claimed'
       and recipient_profile_id = current_setting('test.coach_a')::uuid),
  2,
  'claiming notifies the requester on both channels'
);

-- 8. The unread count is per-viewer.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;

select is(
  count_unread_cover_notifications(current_setting('test.gym')::uuid),
  1,
  'the requester sees only their own unread claim notification'
);

-- 9. RLS: a coach reads their own notifications and nobody else's. Coach A
--    is still the acting user, and coach B holds a cover_requested row.
select is(
  (select count(*)::int from public.cover_notifications
     where recipient_profile_id = current_setting('test.coach_b')::uuid),
  0,
  'a coach cannot read another coach''s cover notifications'
);

select * from finish();
rollback;
