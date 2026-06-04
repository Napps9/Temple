-- After a promotion, the remaining waitlisters' my_waitlist_rank
-- recomputes correctly even though their stored `position` is
-- unchanged. position is insertion order; rank is read-time.

begin;
select plan(4);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wrank.test');
  v_gym   uuid := _test_mk_gym('Rank', 'wrank');
  v_a     uuid := _test_mk_user('a@wrank.test');
  v_w1    uuid := _test_mk_user('w1@wrank.test');
  v_w2    uuid := _test_mk_user('w2@wrank.test');
  v_w3    uuid := _test_mk_user('w3@wrank.test');
  v_plan  uuid;
  v_mid1  uuid;
  v_mid2  uuid;
  v_mid3  uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid1 := _test_mk_membership(v_gym, v_w1, 'member');
  v_mid2 := _test_mk_membership(v_gym, v_w2, 'member');
  v_mid3 := _test_mk_membership(v_gym, v_w3, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid1, v_w1, v_gym, v_plan, 'active'::public.plan_sub_state),
    (v_mid2, v_w2, v_gym, v_plan, 'active'::public.plan_sub_state),
    (v_mid3, v_w3, v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  v_book_a := _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position) values
    (v_gym, v_sess, v_w1, 1),
    (v_gym, v_sess, v_w2, 2),
    (v_gym, v_sess, v_w3, 3);

  perform set_config('test.sess',  v_sess::text,  true);
  perform set_config('test.w1',    v_w1::text,    true);
  perform set_config('test.w2',    v_w2::text,    true);
  perform set_config('test.w3',    v_w3::text,    true);

  -- Promote w1 by cancelling a's booking.
  delete from public.class_bookings where id = v_book_a;

  -- Now w2 and w3 remain, with stored positions 2 and 3.
end;
$$;

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid),
  2,
  'two waitlisters remain after one promotion'
);

select is(
  (select position from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.w2')::uuid),
  2,
  'stored position for w2 is unchanged (still 2)'
);

-- Now run my_waitlist_rank as w2 and assert rank = 1.
do $$
begin
  perform _test_act_as(current_setting('test.w2')::uuid);
end;
$$;

select is(
  public.my_waitlist_rank(current_setting('test.sess')::uuid),
  1,
  'w2 displayed rank is 1 after w1 promoted (was stored position 2)'
);

do $$
begin
  perform _test_act_as(current_setting('test.w3')::uuid);
end;
$$;

select is(
  public.my_waitlist_rank(current_setting('test.sess')::uuid),
  2,
  'w3 displayed rank is 2 after w1 promoted'
);

select * from finish();
rollback;
