-- Admin session cancellation must delete the child bookings (not
-- orphan them) AND refund credits. 0054 used
-- session_replication_role = 'replica', which disabled the ON DELETE
-- CASCADE and left orphaned class_bookings rows; 0065 replaces it with
-- a transaction-local skip flag that keeps the cascade intact.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@cdb.test');
  v_member uuid := _test_mk_user('m@cdb.test');
  v_gym    uuid := _test_mk_gym('Cancel Deletes', 'cancel-deletes');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_ct     uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count, period_length)
    values (v_gym, 'Ten-pack', 'credit_period', 10, interval '30 days')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state, 9)
  returning id into v_sub;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981') returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 12, v_owner, v_ct)
  returning id into v_sess;

  perform _test_mk_booking(v_sess, v_member);

  perform set_config('test.sub',  v_sub::text,  true);
  perform set_config('test.sess', v_sess::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_session(v_sess);
end $$;

-- 1. The session row is gone.
select is(
  (select count(*)::int from public.class_sessions
   where id = current_setting('test.sess')::uuid),
  0,
  'the session row is deleted'
);

-- 2. The child booking is gone too — not orphaned.
select is(
  (select count(*)::int from public.class_bookings
   where class_session_id = current_setting('test.sess')::uuid),
  0,
  'the child class_bookings row is cascade-deleted, not orphaned'
);

-- 3. The credit was refunded once (9 → 10).
select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  10,
  'the credit is refunded exactly once on admin cancellation'
);

select * from finish();
rollback;
