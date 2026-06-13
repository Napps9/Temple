-- A member self-booking with no eligible entitlement is refused only
-- when they hold a plan with this gym (out of credits / lapsed). A
-- member on the membership-access model (no plan at all) still books.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@bre.test');
  v_capped   uuid := _test_mk_user('capped@bre.test');   -- has a credit pack
  v_member   uuid := _test_mk_user('access@bre.test');   -- no plan at all
  v_gym      uuid := _test_mk_gym('Entitlement Gym', 'bre-gym');
  v_mid_c    uuid;
  v_plan     uuid;
  v_sub      uuid;
  v_ct       uuid;
  v_s1       uuid;
  v_s2       uuid;
  v_s3       uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid_c := _test_mk_membership(v_gym, v_capped, 'member');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Capped member: a one-credit pack.
  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Single', 'credit_pack', 1) returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_mid_c, v_capped, v_gym, v_plan, 'active'::public.plan_sub_state, 1)
  returning id into v_sub;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981') returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values (v_gym, 'S1', v_owner, now() + interval '2 days', 60, 12, v_owner, v_ct)
  returning id into v_s1;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values (v_gym, 'S2', v_owner, now() + interval '3 days', 60, 12, v_owner, v_ct)
  returning id into v_s2;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values (v_gym, 'S3', v_owner, now() + interval '4 days', 60, 12, v_owner, v_ct)
  returning id into v_s3;

  perform set_config('test.capped', v_capped::text, true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.s1', v_s1::text, true);
  perform set_config('test.s2', v_s2::text, true);
  perform set_config('test.s3', v_s3::text, true);
end $$;

-- 1. Capped member books S1 — their one credit covers it.
do $$ begin perform _test_act_as(current_setting('test.capped')::uuid); end $$;
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s1')),
  'a member with a credit can book'
);

-- 2. Capped member books S2 — now out of credits, but they HOLD a
--    plan, so booking is refused.
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s2')),
  '%No active plan or credits%',
  'a member out of credits (but holding a plan) is refused'
);

-- 3. Membership-access member (no plan at all) books S3 — allowed on
--    membership alone.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s3')),
  'a member with no plan books on the membership-access model'
);

-- 4. That membership-access booking consumed no entitlement.
select is(
  (select used_entitlement_id from public.class_bookings
   where class_session_id = current_setting('test.s3')::uuid
     and profile_id       = current_setting('test.member')::uuid),
  null,
  'the membership-access booking records no entitlement'
);

select * from finish();
rollback;
