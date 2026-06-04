-- The promotion trigger does NOT mutate request.jwt.claim.sub. After
-- a trigger-fired promotion, auth.uid() in the outer transaction is
-- unchanged. (Catches a regression where the trigger impersonated by
-- setting the GUC; that would leak across the transaction.)

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wforge.test');
  v_gym   uuid := _test_mk_gym('Forge', 'wforge');
  v_a     uuid := _test_mk_user('a@wforge.test');
  v_w     uuid := _test_mk_user('w@wforge.test');
  v_plan  uuid;
  v_mid_w uuid;
  v_ct    uuid;
  v_sess  uuid;
  v_book_a uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  v_mid_w := _test_mk_membership(v_gym, v_w, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid_w, v_w, v_gym, v_plan, 'active'::public.plan_sub_state);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  v_book_a := _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_w, 1);

  -- Set the outer auth context to owner. After the trigger promotes
  -- the waitlister, auth.uid() must still be owner.
  perform _test_act_as(v_owner);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.w',     v_w::text,     true);
  perform set_config('test.sess',  v_sess::text,  true);

  delete from public.class_bookings where id = v_book_a;
end;
$$;

select is(
  auth.uid(),
  current_setting('test.owner')::uuid,
  'auth.uid() unchanged after promotion trigger fires (no GUC bleed)'
);

-- Sanity: the trigger DID run (promotion happened) — otherwise the
-- "no impersonation" claim would be vacuous.
select is(
  (select promoted_from_waitlist from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.w')::uuid),
  true,
  'sanity: waitlister was promoted, proving the trigger ran'
);

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid),
  0,
  'sanity: waitlist consumed'
);

select * from finish();
rollback;
