-- Absolute "cancel by a set time, N days before" free-cancel cutoff
-- (gyms.cancel_cutoff_mode = 'day_before', cancel_cutoff_time,
-- cancel_cutoff_days_before). The refund trigger computes the cutoff
-- from each class's own local date in the gym timezone.
--
-- Determinism: timezone is pinned to UTC and days_before is chosen
-- relative to each session offset so the cutoff lands unambiguously in
-- the past (forfeit) or future (refund) regardless of wall-clock time.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@ccdb.test');
  v_member uuid := _test_mk_user('m@ccdb.test');
  v_gym    uuid := _test_mk_gym('Day-before Gym', 'ccdb-gym');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Pack', 'credit_pack', 10)
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mid, v_member, v_gym, v_plan,
          'active'::public.plan_sub_state, 10)
  returning id into v_sub;

  update public.gyms
    set timezone                      = 'UTC',
        booking_window_hours_ahead    = null,
        booking_cutoff_minutes_before = 0,
        cancel_cutoff_mode            = 'day_before',
        cancel_cutoff_time            = '12:00'
    where id = v_gym;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub',    v_sub::text,    true);
end $$;

-- ── Case A: cutoff already passed → late cancel forfeits ───────────────
-- Class 2 days out, cutoff 5 days before its date → ~3 days ago.
do $$
declare
  v_sess uuid;
begin
  reset role;
  update public.gyms set cancel_cutoff_days_before = 5
    where id = current_setting('test.gym')::uuid;
  v_sess := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '2 days');
  perform set_config('test.late', v_sess::text, true);
  perform _test_act_as(current_setting('test.member')::uuid);
  perform book_class(
    v_sess, 'plan_subscription', current_setting('test.sub')::uuid);
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  9,
  'booking the late class burned one credit (10 - 1 = 9)'
);

do $$ begin
  delete from public.class_bookings
  where class_session_id = current_setting('test.late')::uuid
    and profile_id       = current_setting('test.member')::uuid;
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  9,
  'cancelling past the day-before cutoff forfeits the credit (stays 9)'
);

-- ── Case B: cutoff still ahead → on-time cancel refunds ────────────────
-- Class 10 days out, cutoff 1 day before its date → ~9 days ahead.
do $$
declare
  v_sess uuid;
begin
  reset role;
  update public.gyms set cancel_cutoff_days_before = 1
    where id = current_setting('test.gym')::uuid;
  v_sess := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '10 days');
  perform set_config('test.early', v_sess::text, true);
  perform _test_act_as(current_setting('test.member')::uuid);
  perform book_class(
    v_sess, 'plan_subscription', current_setting('test.sub')::uuid);
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  8,
  'booking the early class burned one credit (9 - 1 = 8)'
);

do $$ begin
  delete from public.class_bookings
  where class_session_id = current_setting('test.early')::uuid
    and profile_id       = current_setting('test.member')::uuid;
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  9,
  'cancelling before the day-before cutoff refunds the credit (8 + 1 = 9)'
);

select * from finish();
rollback;
