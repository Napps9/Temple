-- A removed member fails is_booking_eligible and book_class even with
-- an otherwise-active plan. Proves the predicate fix (left_at is
-- authoritative), not just the RPC side effect.

begin;
select plan(2);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@rebook.test');
  v_gym   uuid := _test_mk_gym('Rebook Block', 'rebookblock');
  v_member uuid := _test_mk_user('m@rebook.test');
  v_plan   uuid;
  v_sess   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select id, v_member, v_gym, v_plan, 'active'::public.plan_sub_state
    from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  -- Set left_at directly (bypass leave_gym) so we test the predicate, not the RPC.
  update public.gym_memberships
    set left_at = now()
    where gym_id = v_gym and profile_id = v_member;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sess',   v_sess::text,   true);

  perform _test_act_as(v_member);
end;
$$;

select is(
  public.is_booking_eligible(
    current_setting('test.member')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.sess')::uuid
  ),
  false,
  'left member fails is_booking_eligible even with an active sub'
);

-- The underlying book_class checks the join directly via _book_class_for;
-- left_at IS NULL is part of that check.
select throws_ok(
  $$ select public.book_class(current_setting('test.sess')::uuid) $$,
  'P0001',
  'Not authorised',
  'left member cannot rebook via book_class'
);

select * from finish();
rollback;
