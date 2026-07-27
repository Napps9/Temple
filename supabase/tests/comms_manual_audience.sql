-- Hand-picked recipients, and the saved segments that hold them.
--
-- The manual audience kind has been in the resolver since 0044 and typed
-- and unit-tested on the client just as long, with no UI to produce one —
-- so nothing ever exercised it server-side either. email_audiences is the
-- same story: full CRUD RLS since 0044, never read or written.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@manaud.test');
  v_coach uuid := _test_mk_user('coach@manaud.test');
  v_a     uuid := _test_mk_user('a@manaud.test');
  v_b     uuid := _test_mk_user('b@manaud.test');
  v_c     uuid := _test_mk_user('c@manaud.test');
  v_gym   uuid := _test_mk_gym('Manual Audience', 'manaud');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object('kind', 'manual', 'profile_ids',
       jsonb_build_array(current_setting('test.a'),
                         current_setting('test.b'))),
     null)),
  2,
  'a hand-picked audience resolves to exactly those members'
);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object('kind', 'manual', 'profile_ids', jsonb_build_array()),
     null)),
  0,
  'and an empty pick reaches nobody rather than everybody'
);

-- A member who unsubscribed is still off the list even when named
-- explicitly: picking someone is not consent.
select lives_ok(
  format(
    $$ insert into public.email_unsubscribes (gym_id, email)
       values (%L::uuid, 'a@manaud.test') $$,
    current_setting('test.gym')
  ),
  'one of them unsubscribes'
);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object('kind', 'manual', 'profile_ids',
       jsonb_build_array(current_setting('test.a'),
                         current_setting('test.b'))),
     null)),
  1,
  'and picking them by hand does not override that'
);

-- Saved segments.
select lives_ok(
  format(
    $$ insert into public.email_audiences (gym_id, name, definition, created_by)
       values (%L::uuid, 'Lapsed regulars',
               '{"kind":"cohort","cohorts":["expired"]}'::jsonb, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.owner')
  ),
  'the owner saves a segment'
);

select _test_act_as(current_setting('test.a')::uuid);

select is(
  (select count(*)::int from public.email_audiences),
  0,
  'a member cannot read the gym''s saved segments'
);

select * from finish();
rollback;
