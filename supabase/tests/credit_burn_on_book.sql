-- Booking a class burns a credit when the entitlement is finite
-- (credit_pack / credit_period / comp_grant with credits_remaining).
-- The refund path (0018, updated in 0050) puts it back on cancel.
-- Until 0052 this was a no-op and finite plans behaved like
-- unlimited ones.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@credburn.test');
  v_member  uuid := _test_mk_user('m@credburn.test');
  v_gym     uuid := _test_mk_gym('Credit Burn Gym', 'cred-burn');
  v_gm      uuid;
  v_plan_p  uuid;
  v_plan_u  uuid;
  v_sub_p   uuid;
  v_sub_u   uuid;
  v_sess    uuid;
  v_sess2   uuid;
  v_grant   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_gm := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Credit pack', 'credit_pack', 5)
    returning plan_id into v_plan_p;
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan_u;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance)
  values (v_gm, v_member, v_gym, v_plan_p,
          'active'::public.plan_sub_state, 5)
  returning id into v_sub_p;

  -- Unlimited sub the member also holds, to assert no-decrement.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_gm, v_member, v_gym, v_plan_u,
          'active'::public.plan_sub_state)
  returning id into v_sub_u;

  v_sess  := _test_mk_session(v_gym, v_owner, now() + interval '2 days');
  v_sess2 := _test_mk_session(v_gym, v_owner, now() + interval '3 days');

  -- Finite comp grant (3 credits).
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at,
     credits_total, credits_remaining, granted_by)
  values
    (v_gym, v_member, now() - interval '1 day', now() + interval '30 days',
     3, 3, v_owner)
  returning grant_id into v_grant;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub_p',  v_sub_p::text,  true);
  perform set_config('test.sub_u',  v_sub_u::text,  true);
  perform set_config('test.sess',   v_sess::text,   true);
  perform set_config('test.sess2',  v_sess2::text,  true);
  perform set_config('test.grant',  v_grant::text,  true);
end $$;

-- 1. Book the credit-pack plan: balance goes 5 → 4.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select lives_ok(
  format(
    'select book_class(%L::uuid, %L, %L::uuid)',
    current_setting('test.sess'),
    'plan_subscription',
    current_setting('test.sub_p')
  ),
  'book with explicit credit_pack plan succeeds'
);

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub_p')::uuid),
  4,
  'credit_balance decremented 5 → 4 after booking the credit pack'
);

-- 2. Cancel that booking: balance returns to 5.
do $$
begin
  delete from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid;
end $$;

select is(
  (select credit_balance from public.plan_subscriptions
   where id = current_setting('test.sub_p')::uuid),
  5,
  'credit_balance restored 4 → 5 after cancel (0018 refund path)'
);

-- 3. Book the comp grant: credits_remaining goes 3 → 2.
select lives_ok(
  format(
    'select book_class(%L::uuid, %L, %L::uuid)',
    current_setting('test.sess'),
    'comp_grant',
    current_setting('test.grant')
  ),
  'book with explicit comp_grant succeeds'
);

select is(
  (select credits_remaining from public.comp_grants
   where grant_id = current_setting('test.grant')::uuid),
  2,
  'credits_remaining decremented 3 → 2 after booking against comp'
);

-- 4. Book the unlimited plan: nothing decrements.
select lives_ok(
  format(
    'select book_class(%L::uuid, %L, %L::uuid)',
    current_setting('test.sess2'),
    'plan_subscription',
    current_setting('test.sub_u')
  ),
  'book with explicit unlimited plan succeeds without touching counts'
);

select * from finish();
rollback;
