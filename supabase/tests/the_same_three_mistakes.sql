-- 0277: the three defect shapes, everywhere else they were made.
--
-- Every test here is a regression test: each one fails on the code as it
-- stood before this migration.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@same.test');
  v_coach uuid := _test_mk_user('coach@same.test');
  v_a     uuid := _test_mk_user('ann@same.test');
  v_b     uuid := _test_mk_user('ben@same.test');
  v_c     uuid := _test_mk_user('cat@same.test');
  v_gym   uuid := _test_mk_gym('Same Gym', 'same-gym');
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');

  update public.profiles set full_name = 'Ann Member'  where id = v_a;
  update public.profiles set full_name = 'Jo Coach'    where id = v_coach;

  -- A full class with three people queued, joined in order b, c, ann.
  v_sess := _test_mk_session(v_gym, v_coach, now() + interval '2 days');
  update public.class_sessions set capacity = 1 where id = v_sess;
  insert into public.class_bookings (gym_id, class_session_id, profile_id)
  values (v_gym, v_sess, v_owner);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
  values (v_gym, v_sess, v_b, 1), (v_gym, v_sess, v_c, 2), (v_gym, v_sess, v_a, 3);

  -- A gym that can text, and Ann set up end to end.
  insert into public.gym_agent_settings (gym_id, enabled, phone_number, sms_capable)
  values (v_gym, true, '+447700900123', true);
  insert into public.member_contact_details (profile_id, phone, phone_e164)
  values (v_a, '07717 503791', '+447717503791');
  update public.gym_memberships set sms_opt_in = true
   where gym_id = v_gym and profile_id = v_a;

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ann', v_a::text, false);
  perform set_config('test.ben', v_b::text, false);
  perform set_config('test.cat', v_c::text, false);
  perform set_config('test.sess', v_sess::text, false);
end $$;

-- ---------------------------------------------------------------------------
-- A1. The roster a member cannot read
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.ann')::uuid);

-- The defect, pinned: reading the table directly gives a member their own
-- row and nothing else, which is why the picker came back empty.
select is(
  (select count(*)::int from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'a member still reads only their own membership row'
);

select is(
  (select count(*)::int from public.gym_directory(
     current_setting('test.gym')::uuid)),
  4,
  'but the directory offers everyone else in the gym'
);

select is(
  (select role::text from public.gym_directory(current_setting('test.gym')::uuid)
    where full_name = 'Jo Coach'),
  'coach',
  'and carries the role, so a member can tell who the gym is'
);

select ok(
  not exists (
    select 1 from public.gym_directory(current_setting('test.gym')::uuid)
    where profile_id = current_setting('test.ann')::uuid
  ),
  'the caller is not offered themselves'
);

-- ---------------------------------------------------------------------------
-- B1. A rank that is not a rank
-- ---------------------------------------------------------------------------

-- Ann joined third, so raw position and true rank agree — for now.
select is(
  (select rank from public.my_waitlist_ranks(
     array[current_setting('test.sess')::uuid])),
  3,
  'a rank matches the raw position while nobody has left'
);

-- The person at the front leaves. position is never renumbered (0016), so
-- this is the exact moment the rendered number began to lie.
reset role;
do $$
begin
  delete from public.class_waitlist
   where class_session_id = current_setting('test.sess')::uuid
     and profile_id = current_setting('test.ben')::uuid;
end $$;

select is(
  (select position from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.ann')::uuid),
  3,
  'the raw column still says 3 after the first in line left'
);

select _test_act_as(current_setting('test.ann')::uuid);
select is(
  (select rank from public.my_waitlist_ranks(
     array[current_setting('test.sess')::uuid])),
  2,
  'the rank says 2, which is the number a member should be shown'
);

-- And it agrees with the singular the class modal already used.
select is(
  (select rank from public.my_waitlist_ranks(
     array[current_setting('test.sess')::uuid])),
  (select public.my_waitlist_rank(current_setting('test.sess')::uuid)),
  'the batch form and the singular cannot disagree'
);

-- ---------------------------------------------------------------------------
-- C1. A dead address stops a member email, declined or not
-- ---------------------------------------------------------------------------

reset role;
do $$
begin
  insert into public.email_suppressions (gym_id, email, reason)
  values (current_setting('test.gym')::uuid, 'ann@same.test', 'hard_bounce');
end $$;

select is(
  (select status from public.member_outbound_messages
    where idempotency_key = 'email:supp1'),
  null,
  'nothing queued yet'
);

do $$
begin
  perform public._enqueue_member_message(
    current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
    'personal_best', 'New best', 'Back squat 105 kg.', 'supp1', false);
end $$;

-- p_honour_unsubscribe is false here on purpose: a bounce must suppress
-- even a message the member never declined.
select is(
  (select status from public.member_outbound_messages
    where idempotency_key = 'email:supp1'),
  'skipped',
  'a suppressed address is skipped even when unsubscribes are not honoured'
);

-- ---------------------------------------------------------------------------
-- C2. An unsubscribe that arrived with the import
-- ---------------------------------------------------------------------------

reset role;
do $$
begin
  insert into public.pending_members (gym_id, email, full_name, unsubscribed)
  values (current_setting('test.gym')::uuid, 'imported@same.test',
          'Imported Person', true);
end $$;

select is(
  (select count(*)::int from public.email_unsubscribes
    where gym_id = current_setting('test.gym')::uuid
      and lower(email) = 'imported@same.test'
      and topic_id is null),
  1,
  'an imported unsubscribe suppresses at import, not at signup'
);

-- ---------------------------------------------------------------------------
-- One refusal, one behaviour
-- ---------------------------------------------------------------------------

reset role;
do $$
begin
  insert into public.member_outbound_messages
    (gym_id, profile_id, kind, channel, body, status, idempotency_key)
  values (current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
          'personal_best', 'sms', 'Nice lift.', 'queued', 'sms:pending1');
end $$;

select _test_act_as(current_setting('test.ann')::uuid);
do $$
begin
  perform public.set_my_sms_opt_in(current_setting('test.gym')::uuid, false);
end $$;

select is(
  (select status from public.member_outbound_messages
    where idempotency_key = 'sms:pending1'),
  'skipped',
  'turning texts off in the app skips a queued text, exactly as STOP does'
);

select * from finish();
rollback;
