-- Per-class-type booking-window overrides (0063): a class_type
-- override beats the gym default. NULL means "fall back to gym
-- default".

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@ctw.test');
  v_member uuid := _test_mk_user('m@ctw.test');
  v_gym    uuid := _test_mk_gym('CT Window Gym', 'ct-window');
  v_mid    uuid;
  v_plan   uuid;
  v_sub    uuid;
  v_ct_open  uuid;
  v_ct_coach uuid;
  v_sess_open uuid;
  v_sess_coach uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlim', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state)
  returning id into v_sub;

  -- Gym default: 60-min booking cutoff applies to everyone.
  update public.gyms
    set booking_cutoff_minutes_before = 60
    where id = v_gym;

  -- Open-gym class type: explicitly overrides to 0 (no cutoff).
  insert into public.class_types
    (gym_id, name, color, booking_cutoff_minutes_before)
    values (v_gym, 'Open gym', '#10B981', 0)
    returning id into v_ct_open;

  -- Coached class type: no override → inherits gym default.
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Coached', '#2563EB')
    returning id into v_ct_coach;

  -- Two sessions starting in 30 minutes (inside the 60-min default
  -- cutoff). Open-gym should be bookable, coached should be refused.
  v_sess_open  := _test_mk_session(
    v_gym, v_owner, now() + interval '30 minutes', 60, v_ct_open);
  v_sess_coach := _test_mk_session(
    v_gym, v_owner, now() + interval '30 minutes', 60, v_ct_coach);

  perform set_config('test.gym',         v_gym::text,         true);
  perform set_config('test.owner',       v_owner::text,       true);
  perform set_config('test.member',      v_member::text,      true);
  perform set_config('test.sess_open',   v_sess_open::text,   true);
  perform set_config('test.sess_coach',  v_sess_coach::text,  true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

-- 1. Open-gym class books at 30 min — override of 0 beats the gym's 60.
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.sess_open')),
  'class_type override of 0 beats the gym default cutoff'
);

-- 2. Coached class is refused — no override, falls back to gym 60.
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.sess_coach')),
  '%Booking closed%',
  'class_type without an override inherits the gym default cutoff'
);

-- 3. Cancel-cutoff override: class_type sets 600 min (10 h).
do $$
declare
  v_ct uuid;
  v_sess uuid;
  v_book uuid;
begin
  reset role;
  select id into v_ct from public.class_types
    where gym_id = current_setting('test.gym')::uuid and name = 'Coached';
  update public.class_types
    set cancel_cutoff_minutes_before = 600
    where id = v_ct;
  -- Member books a coached class 3 hours from now → inside cancel
  -- cutoff. Use staff_book_member to bypass the book-side cutoff.
  v_sess := _test_mk_session(
    current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid,
    now() + interval '3 hours',
    60, v_ct);
  perform set_config('test.late_sess', v_sess::text, true);
  perform _test_act_as(current_setting('test.owner')::uuid);
  v_book := staff_book_member(v_sess,
    current_setting('test.member')::uuid, null, null);
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

-- Sanity: the booking exists.
select is(
  (select count(*)::int from public.class_bookings
   where class_session_id = current_setting('test.late_sess')::uuid),
  1,
  'staff_book_member places the member into the coached class'
);

-- 4. Cancel inside the override cutoff: refund trigger sees the
--    override and skips refund. The booking is on an unlimited plan
--    (no credit_balance to refund anyway), so we just check the row
--    deletes successfully.
do $$ begin
  delete from public.class_bookings
  where class_session_id = current_setting('test.late_sess')::uuid
    and profile_id       = current_setting('test.member')::uuid;
end $$;

select is(
  (select count(*)::int from public.class_bookings
   where class_session_id = current_setting('test.late_sess')::uuid),
  0,
  'cancellation past the class_type override still deletes the booking row'
);

select * from finish();
rollback;
