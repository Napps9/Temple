-- waitlist_for_session is staff-only: members get a "Not authorised"
-- error; staff get the full ranked list.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wstaff.test');
  v_gym   uuid := _test_mk_gym('Staff', 'wstaff');
  v_member uuid := _test_mk_user('m@wstaff.test');
  v_w1    uuid := _test_mk_user('w1@wstaff.test');
  v_w2    uuid := _test_mk_user('w2@wstaff.test');
  v_ct    uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_w1, 'member');
  perform _test_mk_membership(v_gym, v_w2, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position) values
    (v_gym, v_sess, v_w1, 1),
    (v_gym, v_sess, v_w2, 2);

  perform set_config('test.sess',   v_sess::text,   true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
end;
$$;

do $$
begin
  perform _test_act_as(current_setting('test.member')::uuid);
end;
$$;

select throws_ok(
  $$ select * from public.waitlist_for_session(current_setting('test.sess')::uuid) $$,
  'P0001',
  'Not authorised',
  'non-staff member cannot call waitlist_for_session'
);

do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
end;
$$;

select is(
  (select count(*)::int from public.waitlist_for_session(current_setting('test.sess')::uuid)),
  2,
  'staff sees the full ranked list'
);

select is(
  (select rank from public.waitlist_for_session(current_setting('test.sess')::uuid)
    order by rank limit 1),
  1,
  'rank starts at 1'
);

select * from finish();
rollback;
