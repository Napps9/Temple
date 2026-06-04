-- Regression test for the security_invoker view bug we deliberately
-- avoided. Five waitlisters; member at position 5 calls
-- my_waitlist_rank under their own RLS context. Their RLS-visible scan
-- of class_waitlist returns only their own row (per the
-- profile_id = auth.uid() SELECT policy), so a view ranking over the
-- visible rows would always return 1. The SECURITY DEFINER function
-- bypasses RLS and ranks over all 5 entries — should return 5.

begin;
select plan(2);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@rank5.test');
  v_gym   uuid := _test_mk_gym('Rank5', 'rank5');
  v_w     uuid[];
  v_plan  uuid;
  v_mid   uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_a     uuid := _test_mk_user('a@rank5.test');
  i int;
  vid uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  v_w := array[]::uuid[];
  for i in 1..5 loop
    vid := _test_mk_user('w' || i::text || '@rank5.test');
    v_mid := _test_mk_membership(v_gym, vid, 'member');
    insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_mid, vid, v_gym, v_plan, 'active'::public.plan_sub_state);
    insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
      values (v_gym, v_sess, vid, i);
    v_w := array_append(v_w, vid);
  end loop;

  perform set_config('test.sess', v_sess::text, true);
  perform set_config('test.w5',   v_w[5]::text, true);
  perform set_config('test.w1',   v_w[1]::text, true);
end;
$$;

-- Run as the 5th waitlister.
do $$
begin
  perform _test_act_as(current_setting('test.w5')::uuid);
end;
$$;

select is(
  public.my_waitlist_rank(current_setting('test.sess')::uuid),
  5,
  'member at position 5 sees rank 5 even though RLS hides peers'
);

-- Cross-check from position 1.
do $$
begin
  perform _test_act_as(current_setting('test.w1')::uuid);
end;
$$;

select is(
  public.my_waitlist_rank(current_setting('test.sess')::uuid),
  1,
  'member at position 1 sees rank 1'
);

select * from finish();
rollback;
