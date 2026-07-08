-- swap_booking_subscription(..., p_no_charge := true) — 0107. A coach
-- comps an already-charged booking: the credit burned at book time is
-- refunded and the entitlement pointer is nulled so the seat is free.
-- Distinct from staff_book_member's no-charge (0103), which seats a
-- *new* booking; this converts an existing one.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@swapfree.test');
  v_coach  uuid := _test_mk_user('coach@swapfree.test');
  v_member uuid := _test_mk_user('m@swapfree.test');
  v_gym    uuid := _test_mk_gym('Swap Free Gym', 'swap-free');
  v_plan   uuid;
  v_gm_m   uuid;
  v_sub    uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  v_gm_m := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Credit plan', 'credit_pack', 10)
    returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_gm_m, v_member, v_gym, v_plan,
          'active'::public.plan_sub_state, 10)
  returning id into v_sub;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub',    v_sub::text,    true);
  perform set_config('test.sess',   v_sess::text,   true);
end $$;

-- Coach books the member on the credit plan (burns one credit → 9).
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

do $$
begin
  perform staff_book_member(
    current_setting('test.sess')::uuid,
    current_setting('test.member')::uuid,
    'plan_subscription',
    current_setting('test.sub')::uuid);
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
     where id = current_setting('test.sub')::uuid),
  9,
  'booking on the credit plan burned one credit'
);

do $$
declare v_book uuid;
begin
  select id into v_book from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid;
  perform set_config('test.book', v_book::text, true);
end $$;

select lives_ok(
  format(
    'select swap_booking_subscription(%L::uuid, null, null, true)',
    current_setting('test.book')
  ),
  'a coach can swap an existing booking to no charge'
);

select is(
  (select used_entitlement_kind from public.class_bookings
     where id = current_setting('test.book')::uuid),
  null,
  'swapping to no charge nulls the entitlement pointer'
);

select is(
  (select credit_balance from public.plan_subscriptions
     where id = current_setting('test.sub')::uuid),
  10,
  'swapping to no charge refunds the burned credit'
);

-- A bare member cannot comp their own booking.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format(
    'select swap_booking_subscription(%L::uuid, null, null, true)',
    current_setting('test.book')
  ),
  '%Not authorised%',
  'a bare member cannot swap a booking to no charge'
);

select * from finish();
rollback;
