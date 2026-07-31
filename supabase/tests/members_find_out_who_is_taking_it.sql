-- Members find out when their coach changes (0227)
--
-- The point of the change is that BOTH writers tell them — an assignment
-- and a cover claim are the same visible event to a member, and notifying
-- on one path only would be worse than neither.

begin;
select plan(14);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@coachtell.test');
  v_coach  uuid := _test_mk_user('coach@coachtell.test');
  v_jo     uuid := _test_mk_user('jo@coachtell.test');
  v_mem    uuid := _test_mk_user('member@coachtell.test');
  v_quiet  uuid := _test_mk_user('quiet@coachtell.test');
  v_gym    uuid := _test_mk_gym('Coach Gym', 'coachtell');
  v_future uuid;
  v_past   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_jo,    'coach');
  perform _test_mk_membership(v_gym, v_mem, 'member');
  perform _test_mk_membership(v_gym, v_quiet, 'member');

  update public.profiles set full_name = 'Jo Okafor' where id = v_jo;
  update public.profiles set full_name = 'Marcus Webb' where id = v_coach;

  v_future := _test_mk_session(v_gym, v_coach, now() + interval '3 days');
  v_past   := _test_mk_session(v_gym, v_coach, now() - interval '3 days');

  -- Two members booked on the future class; one has opted out of all
  -- email from this gym and must still get the in-app row.
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, v_future, v_mem), (v_gym, v_future, v_quiet);
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, v_past, v_mem);

  insert into public.email_unsubscribes (gym_id, email, topic_id)
  values (v_gym, 'quiet@coachtell.test', null);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.jo',     v_jo::text,     true);
  perform set_config('test.mem',    v_mem::text,    true);
  perform set_config('test.future', v_future::text, true);
  perform set_config('test.past',   v_past::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- The kind exists at all
-- ---------------------------------------------------------------------------

select ok(
  (select pg_get_constraintdef(oid) like '%class_coach_changed%'
     from pg_constraint
     where conrelid = 'public.class_change_notifications'::regclass
       and conname = 'class_change_notifications_kind_check'),
  'the notification table has a coach-change kind'
);

-- ---------------------------------------------------------------------------
-- Assignment tells them
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.jo')
  ),
  'an owner puts a different coach on the class'
);

select is(
  (select count(*)::int from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'in_app'
       and gym_id = current_setting('test.gym')::uuid),
  2,
  'both booked members get an in-app notice'
);

select ok(
  (select body like '%will be taken by Jo%'
     from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'in_app'
       and recipient_profile_id = current_setting('test.mem')::uuid),
  'and it names the coach taking it'
);

select ok(
  (select body like '%your spot is kept%'
     from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'in_app'
       and recipient_profile_id = current_setting('test.mem')::uuid),
  'and says the booking is unaffected, which is the first thing they will wonder'
);

select is(
  (select status from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'email'
       and recipient = 'quiet@coachtell.test'),
  'skipped',
  'somebody who unsubscribed from everything is skipped, not mailed'
);

select ok(
  (select error like '%unsubscribed%'
     from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'email'
       and recipient = 'quiet@coachtell.test'),
  'and the reason is recorded rather than the row vanishing'
);

-- Moving it again tells them again — and the one case that does not.
-- _enqueue_class_coach_changed is revoked from clients, so this goes
-- through the public writer, which is the only way anybody can reach it.

select lives_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.coach')
  ),
  'the class goes back to the original coach'
);

select is(
  (select count(*)::int from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'in_app'
       and gym_id = current_setting('test.gym')::uuid),
  4,
  'and both members are told about that change too'
);

-- The known edge, pinned so it cannot drift silently: the key is the
-- session plus the incoming coach, so a there-and-back does not
-- re-announce somebody they have already been told about. Documented in
-- 0227 as the acceptable way to be wrong — under-telling, not over.
select lives_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.future'), current_setting('test.jo')
  ),
  'and back to Jo again'
);

select is(
  (select count(*)::int from public.class_change_notifications
     where kind = 'class_coach_changed' and channel = 'in_app'
       and gym_id = current_setting('test.gym')::uuid),
  4,
  'which does not re-announce a coach they were already told about'
);

-- ---------------------------------------------------------------------------
-- A class that has already run
-- ---------------------------------------------------------------------------

select lives_ok(
  format(
    'select public.set_session_coach(%L::uuid, %L::uuid)',
    current_setting('test.past'), current_setting('test.jo')
  ),
  'a past class can still have its coach corrected'
);

select is(
  (select count(*)::int from public.class_change_notifications n
     where n.kind = 'class_coach_changed'
       and n.idempotency_key like '%:' || current_setting('test.past') || ':%'),
  0,
  'but nobody is mailed about who taught a class they have already been to'
);

-- ---------------------------------------------------------------------------
-- Cover claims tell them too — the whole point of doing both writers
-- ---------------------------------------------------------------------------

select ok(
  (select pg_get_functiondef(p.oid) like '%_enqueue_class_coach_changed%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_cover'),
  'claim_cover tells the members too, so cover and assignment agree'
);

select * from finish();
rollback;
