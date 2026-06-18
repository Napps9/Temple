-- The booking entitlement gate (0066 + 0082):
--   * A member self-booking with no eligible entitlement is refused when
--     they hold a plan here (out of credits / lapsed).
--   * With gyms.require_membership_to_book on, a member with no plan at
--     all is refused too; staff stay exempt unless their per-person
--     override turns the requirement on.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@bre.test');
  v_capped   uuid := _test_mk_user('capped@bre.test');   -- has a credit pack
  v_member   uuid := _test_mk_user('access@bre.test');   -- no plan at all
  v_member2  uuid := _test_mk_user('access2@bre.test');  -- no plan; tested under require-on
  v_coach    uuid := _test_mk_user('coach@bre.test');    -- staff, no plan
  v_gym      uuid := _test_mk_gym('Entitlement Gym', 'bre-gym');
  v_mid_c    uuid;
  v_plan     uuid;
  v_sub      uuid;
  v_ct       uuid;
  v_s1       uuid;
  v_s2       uuid;
  v_s3       uuid;
  v_s4       uuid;
  v_s5       uuid;
  v_s6       uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  v_mid_c := _test_mk_membership(v_gym, v_capped, 'member');
  perform _test_mk_membership(v_gym, v_member,  'member');
  perform _test_mk_membership(v_gym, v_member2, 'member');
  perform _test_mk_membership(v_gym, v_coach,   'coach');

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
  values
    (v_gym, 'S1', v_owner, now() + interval '2 days', 60, 12, v_owner, v_ct),
    (v_gym, 'S2', v_owner, now() + interval '3 days', 60, 12, v_owner, v_ct),
    (v_gym, 'S3', v_owner, now() + interval '4 days', 60, 12, v_owner, v_ct),
    (v_gym, 'S4', v_owner, now() + interval '5 days', 60, 12, v_owner, v_ct),
    (v_gym, 'S5', v_owner, now() + interval '6 days', 60, 12, v_owner, v_ct),
    (v_gym, 'S6', v_owner, now() + interval '7 days', 60, 12, v_owner, v_ct);
  select id into v_s1 from public.class_sessions where gym_id = v_gym and name = 'S1';
  select id into v_s2 from public.class_sessions where gym_id = v_gym and name = 'S2';
  select id into v_s3 from public.class_sessions where gym_id = v_gym and name = 'S3';
  select id into v_s4 from public.class_sessions where gym_id = v_gym and name = 'S4';
  select id into v_s5 from public.class_sessions where gym_id = v_gym and name = 'S5';
  select id into v_s6 from public.class_sessions where gym_id = v_gym and name = 'S6';

  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.capped', v_capped::text, true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.member2', v_member2::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.s1', v_s1::text, true);
  perform set_config('test.s2', v_s2::text, true);
  perform set_config('test.s3', v_s3::text, true);
  perform set_config('test.s4', v_s4::text, true);
  perform set_config('test.s5', v_s5::text, true);
  perform set_config('test.s6', v_s6::text, true);
end $$;

-- 1. Capped member books S1 — their one credit covers it.
do $$ begin perform _test_act_as(current_setting('test.capped')::uuid); end $$;
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s1')),
  'a member with a credit can book'
);

-- 2. Capped member books S2 — out of credits but HOLDS a plan, refused.
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s2')),
  '%Membership required%',
  'a member out of credits (but holding a plan) is refused'
);

-- 3. Membership-access member (no plan, require off) books S3.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s3')),
  'with require off, a member with no plan books on membership alone'
);

-- 4. That membership-access booking consumed no entitlement.
select is(
  (select used_entitlement_id from public.class_bookings
   where class_session_id = current_setting('test.s3')::uuid
     and profile_id       = current_setting('test.member')::uuid),
  null,
  'the membership-access booking records no entitlement'
);

-- Owner turns on the gym-wide requirement (exercises the RPC).
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select lives_ok(
  format(
    'select set_require_membership_to_book(%L::uuid, true)',
    current_setting('test.gym')
  ),
  'owner can require a membership to book'
);

-- 5. Now a no-plan member is refused.
do $$ begin perform _test_act_as(current_setting('test.member2')::uuid); end $$;
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s4')),
  '%Membership required%',
  'with require on, a member with no membership is refused'
);

-- 6. Staff are exempt by default — the coach books with no plan.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s5')),
  'staff are exempt from the membership requirement by default'
);

-- 7. Per-staff override turns it on for the coach — now refused.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$
begin
  perform set_member_booking_requirement(
    current_setting('test.gym')::uuid,
    current_setting('test.coach')::uuid,
    true
  );
end $$;
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s6')),
  '%Membership required%',
  'a per-staff override requires that staff member to hold a membership'
);

select * from finish();
rollback;
