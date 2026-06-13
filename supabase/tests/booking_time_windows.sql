-- gyms.booking_window_hours_ahead +
-- gyms.booking_cutoff_minutes_before +
-- gyms.cancel_cutoff_minutes_before
--
-- All three default to "unlimited / no cutoff" so existing gyms see
-- no behaviour change. This test pins each of the three rules and
-- checks the staff-bypass (user_can_assign_plan) on the two book-side
-- gates.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@btw.test');
  v_member uuid := _test_mk_user('m@btw.test');
  v_gym    uuid := _test_mk_gym('Time-window Gym', 'btw-gym');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_far    uuid;
  v_soon   uuid;
  v_ok     uuid;
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

  v_far  := _test_mk_session(v_gym, v_owner, now() + interval '10 days');
  v_soon := _test_mk_session(v_gym, v_owner, now() + interval '30 minutes');
  v_ok   := _test_mk_session(v_gym, v_owner, now() + interval '3 days');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub',    v_sub::text,    true);
  perform set_config('test.far',    v_far::text,    true);
  perform set_config('test.soon',   v_soon::text,   true);
  perform set_config('test.ok',     v_ok::text,     true);
end $$;

-- 1. booking_window_hours_ahead = 48 → 10-day-out class refused.
update public.gyms
  set booking_window_hours_ahead = 48
  where id = current_setting('test.gym')::uuid;

do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.far')),
  '%Booking not yet open%',
  'a class outside booking_window_hours_ahead is refused'
);

-- 2. The cutoff doesn't apply to staff (user_can_assign_plan bypass).
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select lives_ok(
  format(
    'select staff_book_member(%L::uuid, %L::uuid, null, null)',
    current_setting('test.far'),
    current_setting('test.member')
  ),
  'a coach books the same far-future class for the member on their behalf'
);

-- 3. booking_cutoff_minutes_before = 60 → class starting in 30min refused.
do $$ begin reset role; end $$;
update public.gyms
  set booking_window_hours_ahead     = null,
      booking_cutoff_minutes_before  = 60
  where id = current_setting('test.gym')::uuid;
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.soon')),
  '%Booking closed%',
  'a class inside booking_cutoff_minutes_before is refused'
);

-- 4. A class outside both cutoffs books normally.
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.ok')),
  'a class outside both windows books normally'
);

-- 5. cancel_cutoff_minutes_before forfeits the credit on late cancel.
do $$
declare
  v_late_sess uuid;
begin
  reset role;
  update public.gyms
    set booking_cutoff_minutes_before  = 0,
        cancel_cutoff_minutes_before   = 600  -- 10 hours
    where id = current_setting('test.gym')::uuid;
  -- Class 3 hours from now (well inside the 10-hour cancel cutoff).
  v_late_sess := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '3 hours');
  perform set_config('test.late_sess', v_late_sess::text, true);
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

-- Book first (so we have something to cancel).
do $$ begin
  perform book_class(
    current_setting('test.late_sess')::uuid,
    'plan_subscription',
    current_setting('test.sub')::uuid);
end $$;

-- credit_balance reflects the burn from staff_book (test 2), the
-- member's v_ok book (test 4), and this v_late_sess book — three
-- decrements from 10. Sanity:
select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  7,
  'credit_balance reflects three prior bookings (10 - 3 = 7)'
);

-- Late-cancel: delete the booking; the trigger should skip the refund.
do $$ begin
  delete from public.class_bookings
  where class_session_id = current_setting('test.late_sess')::uuid
    and profile_id       = current_setting('test.member')::uuid;
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub')::uuid),
  7,
  'late-cancel forfeits the credit (balance stays at 7, no refund)'
);

select * from finish();
rollback;
