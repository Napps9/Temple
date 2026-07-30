-- Cancelling a class tells the people who booked it (0212).
--
-- Until 0212 it told them nothing: close_gym_dates and bulk_edit_sessions
-- enqueued class_change_notifications, and the three cancel RPCs an owner
-- actually reaches for enqueued none. The booking simply stopped existing.
--
-- The ordering is the whole trick, and it is what this file pins: the
-- enqueue has to happen while the bookings are still there, because the
-- recipients ARE the people whose bookings the cancel is about to delete.
-- Called the other way round it succeeds, writes nothing, and reports zero
-- — a silence that looks exactly like a class nobody had booked.
--
-- The dispatcher 0212 adds is not asserted here: sweeps_are_cron_only.sql
-- already pins the whole dispatch_* family as unreachable from a browser,
-- which is the property that matters and the one a new dispatcher is most
-- likely to get wrong.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cancelnotify.test');
  v_a     uuid := _test_mk_user('anna@cancelnotify.test');
  v_b     uuid := _test_mk_user('bo@cancelnotify.test');
  v_gym   uuid := _test_mk_gym('Cancel Notify', 'cancelnotify');
  v_ct    uuid;
  v_sess  uuid;
  v_solo  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Barbell club', '#2563EB') returning id into v_ct;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days', 60, v_ct);
  v_solo := _test_mk_session(v_gym, v_owner, now() + interval '3 days', 60, v_ct);

  perform _test_mk_booking(v_sess, v_a);
  perform _test_mk_booking(v_sess, v_b);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.sess',  v_sess::text,  true);
  perform set_config('test.solo',  v_solo::text,  true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

-- ============================================================================
-- Cancelling tells everyone who was in it
-- ============================================================================

select is(
  public.cancel_session(current_setting('test.sess')::uuid),
  2,
  'cancelling reports how many members were told, not a constant'
);

select is(
  (select count(*)::int from public.class_change_notifications
    where kind = 'class_cancelled' and channel = 'in_app'),
  2,
  'both members get an in-app notice'
);

select is(
  (select count(*)::int from public.class_change_notifications
    where kind = 'class_cancelled' and channel = 'email'),
  2,
  'and an email each'
);

select is(
  (select status from public.class_change_notifications
    where kind = 'class_cancelled' and channel = 'in_app'
      and recipient_profile_id = current_setting('test.a')::uuid),
  'sent',
  'in-app is written already-sent, because it is read from the table'
);

select is(
  (select status from public.class_change_notifications
    where kind = 'class_cancelled' and channel = 'email'
      and recipient_profile_id = current_setting('test.a')::uuid),
  'queued',
  'email is queued for the dispatcher'
);

-- The member should be able to read what happened without decoding it.
select ok(
  (select body like 'Your Barbell club on %has been cancelled. The credit you used has been returned.'
     from public.class_change_notifications
     where kind = 'class_cancelled' and channel = 'in_app'
       and recipient_profile_id = current_setting('test.a')::uuid),
  'the notice names the class and says the credit came back'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  0,
  'and the class is actually gone — the notice is not instead of cancelling'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid),
  0,
  'with its bookings'
);

-- ============================================================================
-- The quiet cases stay quiet
-- ============================================================================

select is(
  public.cancel_session(current_setting('test.solo')::uuid),
  0,
  'a class nobody booked tells nobody, and says so'
);

select throws_ok(
  $$ select public.cancel_session(current_setting('test.sess')::uuid) $$,
  'Session not found',
  'cancelling the same class twice is refused rather than notifying again'
);

select * from finish();
rollback;
