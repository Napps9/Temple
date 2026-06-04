-- leave_gym removes the member's class_waitlist rows. Otherwise
-- waitlist_for_session would surface them as ghost rows to staff
-- (counted in the rank, skipped during promotion).

begin;
select plan(2);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@wprune.test');
  v_gym   uuid := _test_mk_gym('Prune', 'wprune');
  v_member uuid := _test_mk_user('m@wprune.test');
  v_ct    uuid;
  v_sess1 uuid;
  v_sess2 uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT', '#10B981')
    returning id into v_ct;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'S1', v_owner, now() + interval '2 days', 60, 1, v_owner, v_ct)
  returning id into v_sess1;
  insert into public.class_sessions
    (gym_id, name, coach_id, starts_at, duration_minutes, capacity, created_by, class_type_id)
  values
    (v_gym, 'S2', v_owner, now() + interval '3 days', 60, 1, v_owner, v_ct)
  returning id into v_sess2;

  insert into public.class_waitlist (gym_id, class_session_id, profile_id, position) values
    (v_gym, v_sess1, v_member, 1),
    (v_gym, v_sess2, v_member, 1);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);

  perform _test_act_as(v_owner);
  perform public.leave_gym(v_gym, v_member);
end;
$$;

select is(
  (select count(*)::int from public.class_waitlist
    where profile_id = current_setting('test.member')::uuid),
  0,
  'leave_gym deletes the member''s waitlist rows for every session'
);

select is(
  (select count(*)::int from public.class_waitlist
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'no ghost rows linger for the removed member in this gym'
);

select * from finish();
rollback;
