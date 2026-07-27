-- Invariant: a blanket email unsubscribe suppresses the cover EMAIL but
-- never the in-app notification, and the suppression is recorded rather
-- than silently dropped.
--
-- A coach who opted out of the gym's newsletter still needs to see cover
-- in the app — otherwise an unsubscribe quietly becomes an operational
-- hole where a class goes unstaffed.
--
-- Also pins the qualification filter: a coach barred from every class
-- type in the request cannot claim any of it, so telling them is noise.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covsupp.test');
  v_coach_a uuid := _test_mk_user('coach_a@covsupp.test');  -- requester
  v_unsub   uuid := _test_mk_user('unsub@covsupp.test');    -- blanket unsub
  v_barred  uuid := _test_mk_user('barred@covsupp.test');   -- disqualified
  v_gym     uuid := _test_mk_gym('Suppress Gym', 'covsupp');
  v_ct      uuid;
  v_session uuid;
  v_request uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_unsub,   'coach');
  perform _test_mk_membership(v_gym, v_barred,  'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Olympic Lifting', '#2563EB')
    returning id into v_ct;

  -- Blanket unsubscribe (topic_id null = "send me nothing").
  insert into public.email_unsubscribes (gym_id, email, profile_id, reason)
    values (v_gym, 'unsub@covsupp.test', v_unsub, 'test');

  -- Barred from the only class type in the request.
  insert into public.coach_class_type_qualifications
    (gym_id, profile_id, class_type_id, qualified, updated_by)
    values (v_gym, v_barred, v_ct, false, v_owner);

  v_session := _test_mk_session(v_gym, v_coach_a,
    now() + interval '3 days', 60, v_ct);

  perform _test_act_as(v_coach_a);
  v_request := request_cover(array[v_session], null::text);

  perform set_config('test.request', v_request::text, true);
  perform set_config('test.unsub',   v_unsub::text,   true);
  perform set_config('test.barred',  v_barred::text,  true);
  perform set_config('test.owner',   v_owner::text,   true);

  -- Assert as the owner: cover_notifications is RLS'd to your own rows
  -- plus an admin's view of the gym.
  perform _test_act_as(v_owner);
end;
$$;

-- 1. The unsubscribed coach still gets the in-app notification.
select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.unsub')::uuid),
  'sent',
  'a blanket unsubscribe does not suppress the in-app notification'
);

-- 2. But the email is skipped, not queued.
select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'email'
       and recipient_profile_id = current_setting('test.unsub')::uuid),
  'skipped',
  'a blanket unsubscribe suppresses the cover email'
);

-- 3. And the reason is recorded, so it is visible rather than lost.
select isnt(
  (select error from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and channel = 'email'
       and recipient_profile_id = current_setting('test.unsub')::uuid),
  null,
  'the suppression reason is recorded on the row'
);

-- 4. A coach disqualified for every class type in the request is skipped
--    entirely — no row on either channel.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and recipient_profile_id = current_setting('test.barred')::uuid),
  0,
  'a coach barred from every class type in the request is not notified'
);

-- 5. The owner, who is not barred, still is.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.request')::uuid
       and recipient_profile_id = current_setting('test.owner')::uuid),
  2,
  'an eligible recipient still gets both channels'
);

select * from finish();
rollback;
