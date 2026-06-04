-- Cancelling a session drops every class_waitlist row for that session.
-- (Without this step, waitlist_for_session would surface ghost rows
-- pointing at a deleted class_session_id.)

begin;
select plan(1);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@candrop.test');
  v_gym   uuid := _test_mk_gym('Drop WL', 'candrop');
  v_a     uuid := _test_mk_user('a@candrop.test');
  v_b     uuid := _test_mk_user('b@candrop.test');
  v_w     uuid := _test_mk_user('w@candrop.test');
  v_ct    uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_w, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'Sess', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess;

  perform _test_mk_booking(v_sess, v_a);
  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position)
    values (v_gym, v_sess, v_w, 1);

  perform set_config('test.sess', v_sess::text, true);

  perform _test_act_as(v_owner);
  perform public.cancel_session(v_sess);
end;
$$;

select is(
  (select count(*)::int from public.class_waitlist
    where class_session_id = current_setting('test.sess')::uuid),
  0,
  'no waitlist rows remain for the cancelled session'
);

select * from finish();
rollback;
