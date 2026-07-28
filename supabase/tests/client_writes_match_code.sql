-- Invariant: authenticated cannot write, directly, a table it only ever
-- reaches through a security-definer RPC.
--
-- 0195 revoked four client writes that RLS pinned by row but not by
-- column (the 0194 class). The grant is invisible in a policy, so it
-- needs a test that names the privilege — and the intended path has to
-- keep working, or the revoke has broken a real feature rather than
-- closed a hole.

begin;
select plan(9);

\ir _helpers.psql

-- ---- part A: the revoked writes are gone --------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.plan_subscriptions', 'update')
  and not has_table_privilege('authenticated', 'public.plan_subscriptions', 'insert')
  and not has_table_privilege('authenticated', 'public.plan_subscriptions', 'delete'),
  'authenticated cannot write plan_subscriptions directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.direct_messages', 'update'),
  'authenticated cannot UPDATE direct_messages directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.gym_announcements', 'update'),
  'authenticated cannot UPDATE gym_announcements directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.class_sessions', 'update'),
  'authenticated cannot UPDATE class_sessions directly'
);

-- The dead policies are gone too, so a later re-grant cannot silently
-- inherit user_can_assign_plan as its guard.
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.plan_subscriptions'::regclass and polcmd in ('a', 'w')),
  0,
  'and its two misleading write policies were dropped with the grant'
);

-- ---- part B: the intended path still works ------------------------------

do $$
declare
  v_owner uuid := _test_mk_user('owner@cwm.test');
  v_coach uuid := _test_mk_user('coach@cwm.test');
  v_a     uuid := _test_mk_user('a@cwm.test');
  v_b     uuid := _test_mk_user('b@cwm.test');
  v_gym   uuid := _test_mk_gym('CWM Gym', 'cwm-gym');
  v_mid   uuid;
  v_plan  uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_mid := _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 6000)
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_mid, v_a, v_gym, v_plan, 'active'::public.plan_sub_state, 6000);

  v_sess := _test_mk_session(v_gym, v_coach, now() + interval '2 days');

  -- A message from A to B, for the recipient to mark read.
  insert into public.direct_messages (gym_id, sender_id, recipient_id, body)
    values (v_gym, v_a, v_b, 'hello');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.sess',  v_sess::text,  true);
end;
$$;

-- The recipient still marks a thread read through the definer RPC — the
-- one legitimate reason the revoked UPDATE policy existed.
select _test_act_as(current_setting('test.b')::uuid);
select lives_ok(
  $$ select public.mark_dm_thread_read(current_setting('test.a')::uuid) $$,
  'a recipient still marks a DM thread read through the RPC'
);
select is(
  (select count(*)::int from public.direct_messages
    where recipient_id = current_setting('test.b')::uuid and read_at is not null),
  1,
  'and the message is actually flagged read'
);

-- An owner still edits a class session through bulk_edit_sessions, which
-- is the definer path the direct UPDATE was routing around.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format(
    $$ select public.bulk_edit_sessions(%L::uuid, %L::date, %L::date,
         array[%L::uuid], null, 45, null) $$,
    current_setting('test.gym'),
    (now())::date, (now() + interval '7 days')::date,
    current_setting('test.sess')
  ),
  'an owner still edits a session through bulk_edit_sessions'
);
select is(
  (select duration_minutes from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  45,
  'and the change actually lands'
);

select * from finish();
rollback;
