-- Staff can work the waitlist (0214).
--
-- join_waitlist and leave_waitlist are auth.uid()-only with no target
-- parameter, and class_waitlist has no write policy at all, so until now
-- the only way to get someone onto a full class was to ask them to do it
-- on their own phone. That mattered the moment a card offered "put them on
-- the waitlist instead" as the alternative to going over the cap.
--
-- The interesting assertion is the last pair: a waitlisted member is not a
-- promise, it is a queue that the booking machinery actually honours. So
-- this ends by taking someone out and checking the next name moved into the
-- seat by itself.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@staffwait.test');
  v_a     uuid := _test_mk_user('anna@staffwait.test');
  v_b     uuid := _test_mk_user('bo@staffwait.test');
  v_c     uuid := _test_mk_user('cass@staffwait.test');
  v_out   uuid := _test_mk_user('outsider@staffwait.test');
  v_gym   uuid := _test_mk_gym('Staff Waitlist', 'staffwait');
  v_else  uuid := _test_mk_gym('Elsewhere', 'staffwaitelse');
  v_ct    uuid;
  v_full  uuid;
  v_roomy uuid;
  v_plan  uuid;
  v_mid   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');
  perform _test_mk_membership(v_else, v_out, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Barbell club', '#2563EB') returning id into v_ct;

  -- The promotion trigger only promotes someone ELIGIBLE, so a waitlist of
  -- members with no membership never moves. Giving them one is what makes
  -- the last two assertions test the queue rather than the entitlement.
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_plan;
  foreach v_mid in array array[v_a, v_b, v_c] loop
    insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
       paid_period_end, imported_legacy)
    values (
      (select id from public.gym_memberships
        where gym_id = v_gym and profile_id = v_mid),
      v_mid, v_gym, v_plan, 'active'::public.plan_sub_state, 8900,
      now() + interval '30 days', true);
  end loop;

  v_full  := _test_mk_session(v_gym, v_owner, now() + interval '2 days', 60, v_ct);
  v_roomy := _test_mk_session(v_gym, v_owner, now() + interval '3 days', 60, v_ct);
  update public.class_sessions set capacity = 1 where id = v_full;

  -- One seat, taken.
  perform _test_mk_booking(v_full, v_a);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.c',     v_c::text,     true);
  perform set_config('test.out',   v_out::text,   true);
  perform set_config('test.full',  v_full::text,  true);
  perform set_config('test.roomy', v_roomy::text, true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  public.staff_join_waitlist(
    current_setting('test.gym')::uuid,
    current_setting('test.full')::uuid,
    current_setting('test.b')::uuid),
  1,
  'staff can put a member on a full class''s waitlist, and get their place back'
);

select is(
  public.staff_join_waitlist(
    current_setting('test.gym')::uuid,
    current_setting('test.full')::uuid,
    current_setting('test.c')::uuid),
  2,
  'the next one queues behind them'
);

-- position is insertion order and never rewritten, so the rank has to be
-- computed rather than read.
select is(
  public.staff_join_waitlist(
    current_setting('test.gym')::uuid,
    current_setting('test.full')::uuid,
    current_setting('test.b')::uuid),
  1,
  'adding someone already queued keeps their place rather than moving them back'
);

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.full')::uuid),
  2,
  'and does not queue them twice'
);

-- ============================================================================
-- What it refuses
-- ============================================================================

select throws_ok(
  $$ select public.staff_join_waitlist(
       current_setting('test.gym')::uuid,
       current_setting('test.roomy')::uuid,
       current_setting('test.b')::uuid) $$,
  'Class has spare capacity — book them in directly',
  'a class with room is not a waitlist — say so rather than queue them behind nobody'
);

select throws_ok(
  $$ select public.staff_join_waitlist(
       current_setting('test.gym')::uuid,
       current_setting('test.full')::uuid,
       current_setting('test.out')::uuid) $$,
  'Not a member of this gym',
  'and someone from another gym cannot be queued into this one'
);

select _test_act_as(current_setting('test.a')::uuid);

select throws_ok(
  $$ select public.staff_join_waitlist(
       current_setting('test.gym')::uuid,
       current_setting('test.full')::uuid,
       current_setting('test.c')::uuid) $$,
  'Not authorised',
  'a member cannot queue somebody else'
);

-- ============================================================================
-- Taking a name off
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  public.staff_leave_waitlist(
    current_setting('test.gym')::uuid,
    current_setting('test.full')::uuid,
    current_setting('test.c')::uuid),
  true,
  'staff can take a name off the queue'
);

select is(
  public.staff_leave_waitlist(
    current_setting('test.gym')::uuid,
    current_setting('test.full')::uuid,
    current_setting('test.c')::uuid),
  false,
  'and taking off someone who was never on it reports that, rather than pretending'
);

-- ============================================================================
-- The queue is real: it fills the seat by itself
-- ============================================================================

select is(
  (public.remove_member_booking(
     current_setting('test.gym')::uuid,
     current_setting('test.full')::uuid,
     current_setting('test.a')::uuid) ->> 'promoted_name'),
  'bo@staffwait.test',
  'freeing the seat names who came off the waitlist into it'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.full')::uuid
      and profile_id = current_setting('test.b')::uuid),
  1,
  'and they really are booked in, not merely reported'
);

select * from finish();
rollback;
