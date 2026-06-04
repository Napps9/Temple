-- Archiving a class type with sessions does NOT delete the sessions,
-- and the sessions still resolve their class_type_id (so past-booking
-- screens can render the type name).
--
-- Invariant: archive preserves history (§6.1 plan).

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@archct.test');
  v_gym   uuid := _test_mk_gym('Archive CT', 'archct');
  v_ct    uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Olympic', '#2563EB')
    returning id into v_ct;
  v_sess := _test_mk_session(v_gym, v_owner, now() + interval '1 day', 60, v_ct);

  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.ct',   v_ct::text,   true);
  perform set_config('test.sess', v_sess::text, true);

  perform _test_act_as(v_owner);
  perform public.archive_class_type(v_ct);
end;
$$;

select isnt(
  (select archived_at from public.class_types
    where id = current_setting('test.ct')::uuid),
  null,
  'archive_class_type sets archived_at'
);

select is(
  (select count(*)::int from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  1,
  'session row still exists after archiving its class type'
);

select is(
  (select class_type_id from public.class_sessions
    where id = current_setting('test.sess')::uuid),
  current_setting('test.ct')::uuid,
  'session.class_type_id still resolves to the archived type'
);

select * from finish();
rollback;
