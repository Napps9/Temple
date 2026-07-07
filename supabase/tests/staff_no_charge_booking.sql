-- staff_book_member(..., p_no_charge := true) — 0091. A coach can seat
-- a member for free even when that member holds a valid, chargeable
-- plan: no entitlement should be recorded and no credit should burn.
-- This is the case the old "pass null kind/id" trick couldn't cover,
-- since null/null auto-picks the member's default entitlement.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@nocharge.test');
  v_coach  uuid := _test_mk_user('coach@nocharge.test');
  v_member uuid := _test_mk_user('m@nocharge.test');
  v_gym    uuid := _test_mk_gym('No Charge Gym', 'no-charge');
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

do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

select lives_ok(
  format(
    'select staff_book_member(%L::uuid, %L::uuid, null, null, true)',
    current_setting('test.sess'),
    current_setting('test.member')
  ),
  'a coach can book a member with p_no_charge even though they hold a plan'
);

select is(
  (
    select used_entitlement_kind from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  null,
  'a no-charge booking records no entitlement kind'
);

select is(
  (
    select used_entitlement_id from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id       = current_setting('test.member')::uuid
  ),
  null,
  'a no-charge booking records no entitlement id'
);

select is(
  (
    select credit_balance from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid
  ),
  10,
  'the member''s plan credit is untouched by a no-charge booking'
);

select * from finish();
rollback;
