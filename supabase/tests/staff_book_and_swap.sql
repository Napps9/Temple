-- staff_book_member and swap_booking_subscription (0051) are the two
-- staff-side flows from Phase 1b:
--
--   - A coach books a member into a class on their behalf, picking
--     which entitlement gets consumed. user_can_assign_plan gate.
--   - A coach swaps which entitlement an existing booking is charged
--     against (e.g. wrong plan picked, refund needs to flip target).

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@staffbook.test');
  v_coach   uuid := _test_mk_user('coach@staffbook.test');
  v_member  uuid := _test_mk_user('m@staffbook.test');
  v_other   uuid := _test_mk_user('other@staffbook.test');
  v_gym     uuid := _test_mk_gym('Staff Book Gym', 'staff-book');
  v_other_gym uuid := _test_mk_gym('Other Gym', 'other-staffbook');
  v_plan_a  uuid;
  v_plan_b  uuid;
  v_sub_a   uuid;
  v_sub_b   uuid;
  v_gm_m    uuid;
  v_sess    uuid;
  v_book    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  v_gm_m := _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_other_gym, v_other, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Plan A (credits)', 'credit_pack', 10)
    returning plan_id into v_plan_a;
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Plan B (unlimited)', 'unlimited')
    returning plan_id into v_plan_b;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_gm_m, v_member, v_gym, v_plan_a,
          'active'::public.plan_sub_state, 10)
  returning id into v_sub_a;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_gm_m, v_member, v_gym, v_plan_b,
          'active'::public.plan_sub_state)
  returning id into v_sub_b;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.sub_a',  v_sub_a::text,  true);
  perform set_config('test.sub_b',  v_sub_b::text,  true);
  perform set_config('test.sess',   v_sess::text,   true);
end $$;

-- 1. A bare member can't book another member.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format(
    'select staff_book_member(%L::uuid, %L::uuid, null, null)',
    current_setting('test.sess'),
    current_setting('test.other')
  ),
  '%Not authorised%',
  'a member cannot staff_book_member another user'
);

-- 2. A coach books the member, with an explicit plan choice.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select lives_ok(
  format(
    'select staff_book_member(%L::uuid, %L::uuid, %L, %L::uuid)',
    current_setting('test.sess'),
    current_setting('test.member'),
    'plan_subscription',
    current_setting('test.sub_b')
  ),
  'a coach can book a member with an explicit plan choice'
);

-- 3. The booking row records the chosen plan + the coach as booker.
select is(
  (
    select used_entitlement_id::text from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  current_setting('test.sub_b'),
  'the booking row records the explicitly-chosen plan'
);

select is(
  (
    select booked_by_profile_id::text from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  current_setting('test.coach'),
  'booked_by_profile_id records the coach who clicked book'
);

-- 4. The coach swaps the booking onto sub_a.
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
    'select swap_booking_subscription(%L::uuid, %L, %L::uuid)',
    current_setting('test.book'),
    'plan_subscription',
    current_setting('test.sub_a')
  ),
  'a coach can swap the booking onto a different eligible plan'
);

-- 5. The booking row reflects the swap.
select is(
  (
    select used_entitlement_id::text from public.class_bookings
    where id = current_setting('test.book')::uuid
  ),
  current_setting('test.sub_a'),
  'used_entitlement_id is updated after the swap'
);

-- 6. A swap onto an entitlement that doesn't belong to the booking's
--    profile is refused.
do $$
declare
  v_other_plan uuid;
  v_other_sub  uuid;
  v_other_gm   uuid;
begin
  reset role;
  v_other_gm := _test_mk_membership(
    current_setting('test.gym')::uuid,
    current_setting('test.other')::uuid,
    'member');
  insert into public.membership_plans (gym_id, name, kind)
    values (current_setting('test.gym')::uuid, 'Other plan', 'unlimited')
    returning plan_id into v_other_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_other_gm,
          current_setting('test.other')::uuid,
          current_setting('test.gym')::uuid,
          v_other_plan,
          'active'::public.plan_sub_state)
  returning id into v_other_sub;
  perform set_config('test.other_sub', v_other_sub::text, true);
  perform _test_act_as(current_setting('test.coach')::uuid);
end $$;

select throws_like(
  format(
    'select swap_booking_subscription(%L::uuid, %L, %L::uuid)',
    current_setting('test.book'),
    'plan_subscription',
    current_setting('test.other_sub')
  ),
  '%not eligible%',
  'swap refuses an entitlement that belongs to another member'
);

-- 7. A bare member can't swap (not even their own booking).
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format(
    'select swap_booking_subscription(%L::uuid, %L, %L::uuid)',
    current_setting('test.book'),
    'plan_subscription',
    current_setting('test.sub_b')
  ),
  '%Not authorised%',
  'a bare member cannot swap their own booking'
);

-- 8. Swap onto a non-existent entitlement id is refused.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select throws_like(
  format(
    'select swap_booking_subscription(%L::uuid, %L, %L::uuid)',
    current_setting('test.book'),
    'plan_subscription',
    gen_random_uuid()
  ),
  '%not eligible%',
  'swap refuses a made-up entitlement id'
);

select * from finish();
rollback;
