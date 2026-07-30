-- Staff booking and removal (0213).
--
-- Half of this file is not about the new behaviour at all. 0213 restates
-- _book_class_for — two hundred lines carrying every booking invariant in
-- Temple — in order to change one condition. A restatement that silently
-- drops a gate is the worst thing that could come out of this migration and
-- the least visible, so the gates are asserted here rather than trusted:
-- membership, timing, capacity, and that the override does not become a
-- skeleton key for the rest.
--
-- The rest pins the two things that were dishonest. Booking someone already
-- in the class returned NULL rather than raising, so a caller reporting
-- "booked" on a non-throwing call was lying. And removing someone had no
-- function at all — only an RLS policy that excludes the staff role, which
-- PostgREST reports as a successful delete of zero rows.

begin;
select plan(16);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@bookinout.test');
  v_coach  uuid := _test_mk_user('coach@bookinout.test');
  v_a      uuid := _test_mk_user('anna@bookinout.test');
  v_b      uuid := _test_mk_user('bo@bookinout.test');
  v_c      uuid := _test_mk_user('cass@bookinout.test');
  v_out    uuid := _test_mk_user('outsider@bookinout.test');
  v_gym    uuid := _test_mk_gym('Book In Out', 'bookinout');
  v_other  uuid := _test_mk_gym('Elsewhere', 'bookinoutelse');
  v_ct     uuid;
  v_sess   uuid;
  v_tiny   uuid;
  v_past   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');
  perform _test_mk_membership(v_other, v_out, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Barbell club', '#2563EB') returning id into v_ct;

  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '2 days', 60, v_ct);
  v_tiny := _test_mk_session(v_gym, v_owner, now() + interval '3 days', 60, v_ct);
  update public.class_sessions set capacity = 1 where id = v_tiny;

  -- A session that has already started, for the timing gate.
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity,
     created_by, class_type_id)
  values (v_gym, 'Gone', v_owner, now() - interval '1 hour', 60, 12,
     v_owner, v_ct)
  returning id into v_past;

  -- can_issue_override defaults to TRUE for coach (src/lib/can.ts:55), so
  -- the interesting question is not whether a coach has it but whether
  -- turning it off in the capability matrix is actually obeyed by the write.
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (v_gym, 'coach', 'can_issue_override', false);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.c',     v_c::text,     true);
  perform set_config('test.out',   v_out::text,   true);
  perform set_config('test.sess',  v_sess::text,  true);
  perform set_config('test.tiny',  v_tiny::text,  true);
  perform set_config('test.past',  v_past::text,  true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

-- ============================================================================
-- Booking someone in
-- ============================================================================

select isnt(
  public.staff_book_member(
    current_setting('test.sess')::uuid, current_setting('test.a')::uuid),
  null,
  'an owner can book a member into a class'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.a')::uuid),
  1,
  'and they are on the roster'
);

-- Was NULL before 0213, which a caller could not tell from success.
select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.sess')::uuid, current_setting('test.a')::uuid) $$,
  'Already booked into this class',
  'booking them twice says so rather than returning nothing'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.a')::uuid),
  1,
  'and does not make a second seat'
);

-- ============================================================================
-- The gates the restatement had to keep
-- ============================================================================

select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.sess')::uuid, current_setting('test.out')::uuid) $$,
  'Not authorised',
  'someone who is not a member of this gym still cannot be booked into it'
);

select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.past')::uuid, current_setting('test.b')::uuid) $$,
  'Class has already started',
  'a class that has started is still refused'
);

select lives_ok(
  $$ select public.staff_book_member(
       current_setting('test.tiny')::uuid, current_setting('test.b')::uuid) $$,
  'the last seat in a class still fills normally'
);

select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.tiny')::uuid, current_setting('test.c')::uuid) $$,
  'Class is full',
  'and capacity still refuses by default — the override is opt-in, not the new normal'
);

-- ============================================================================
-- The override, finally meaning something
-- ============================================================================

select lives_ok(
  $$ select public.staff_book_member(
       current_setting('test.tiny')::uuid, current_setting('test.c')::uuid,
       null, null, false, true) $$,
  'an owner with can_issue_override can go over the cap'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.tiny')::uuid),
  2,
  'and the extra person really is in a class of one'
);

-- The GUC must not survive the call, or the next booking in the same
-- transaction inherits a capacity bypass nobody asked for.
select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.tiny')::uuid, current_setting('test.a')::uuid) $$,
  'Class is full',
  'and the override does not leak into the next booking in the same transaction'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.staff_book_member(
       current_setting('test.tiny')::uuid, current_setting('test.a')::uuid,
       null, null, false, true) $$,
  'Not authorised to go over capacity',
  'and a coach whose override was switched off in the matrix is refused it'
);

-- ============================================================================
-- Taking someone out
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (public.remove_member_booking(
     current_setting('test.gym')::uuid,
     current_setting('test.sess')::uuid,
     current_setting('test.a')::uuid) ->> 'removed')::boolean,
  true,
  'an owner can take a member out of a class'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.a')::uuid),
  0,
  'and the seat is actually free'
);

select throws_ok(
  $$ select public.remove_member_booking(
       current_setting('test.gym')::uuid,
       current_setting('test.sess')::uuid,
       current_setting('test.a')::uuid) $$,
  'Not booked into this class',
  'taking out someone who was never in says so, rather than reporting a quiet nothing'
);

select is(
  (public.remove_member_booking(
     current_setting('test.gym')::uuid,
     current_setting('test.tiny')::uuid,
     current_setting('test.b')::uuid,
     false) ->> 'refunded')::boolean,
  false,
  'and the receipt says whether the credit went back, because the caller chose'
);

select * from finish();
rollback;
