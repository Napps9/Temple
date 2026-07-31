-- Which screens get opened, with no name attached (0233)
--
-- The table has no profile_id, so the thing worth testing is not that it
-- forgets who — it cannot know. What is worth testing is everything that
-- would have to hold for that to stay true and useful: only staff can
-- write, only their own gym, an id never reaches the column, the day is
-- the gym's, and the whole thing is gone at ninety days.
--
-- Every assertion reads as the owner, deliberately. The select policy is
-- can_manage_staff, so a member or an outsider reading the table sees
-- nothing whatever was written — "count is zero" from inside their
-- session would pass whether or not the write had been refused, which is
-- a test that proves the policy and not the function.

begin;
select plan(15);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@routes.test');
  v_coach uuid := _test_mk_user('coach@routes.test');
  v_memb  uuid := _test_mk_user('member@routes.test');
  v_out   uuid := _test_mk_user('outsider@routes.test');
  v_gym   uuid := _test_mk_gym('Route Gym', 'routegym');
  v_gym2  uuid := _test_mk_gym('Other Gym', 'routegym2');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_memb,  'member');
  perform _test_mk_membership(v_gym2, v_out,  'owner');

  -- Sydney, so "the gym's day" is a different date from UTC's for part of
  -- every day and the assertion below means something.
  update public.gyms set timezone = 'Australia/Sydney' where id = v_gym;

  -- Seeded here rather than through the RPC, which only ever writes today.
  -- There is no client insert policy at all, so this is the only way old
  -- rows can exist in a test — which is itself the point.
  insert into public.route_opens (gym_id, route, day, opens)
  values
    (v_gym, '/timeline', current_date - 91, 40),
    (v_gym, '/classes',  current_date - 89, 12);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.gym2',  v_gym2::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.memb',  v_memb::text,  true);
  perform set_config('test.out',   v_out::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- Forgetting it
-- ---------------------------------------------------------------------------
--
-- First, because the sweep is revoked from `authenticated` and
-- _test_act_as cannot be reliably undone (see _helpers.psql) — so a
-- cron-only function can only be exercised before the session takes on a
-- role. sweeps_are_cron_only.sql pins the revoke itself; this pins what
-- it does.

select is(
  public.purge_expired_route_opens(),
  1,
  'the sweep drops what is older than ninety days and nothing else'
);

select is(
  (select count(*)::int from public.route_opens
     where gym_id = current_setting('test.gym')::uuid),
  1,
  'and leaves the row that is inside the window'
);

-- ---------------------------------------------------------------------------
-- A coach on a staff screen
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  format('select public.record_route_open(%L::uuid, %L)',
         current_setting('test.gym'), '/management/members'),
  'a coach on a staff screen records the open'
);

select lives_ok(
  format('select public.record_route_open(%L::uuid, %L)',
         current_setting('test.gym'), '/management/members'),
  'and opening it again records that too'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select opens from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route = '/management/members'),
  2,
  'two opens, one row — the same screen on the same day is a count, not a log'
);

-- ---------------------------------------------------------------------------
-- Everybody else
-- ---------------------------------------------------------------------------
--
-- Silent rather than raising, both times: this is called fire-and-forget
-- from a navigation effect, and an exception there is a crash on a screen
-- change for the sake of a counter.

select _test_act_as(current_setting('test.memb')::uuid);

select lives_ok(
  format('select public.record_route_open(%L::uuid, %L)',
         current_setting('test.gym'), '/management/plans'),
  'a member calling it is not an error'
);

select _test_act_as(current_setting('test.out')::uuid);

select lives_ok(
  format('select public.record_route_open(%L::uuid, %L)',
         current_setting('test.gym'), '/management/billing'),
  'nor is an owner of another gym calling it'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route = '/management/plans'),
  0,
  'but the member wrote nothing'
);

select is(
  (select count(*)::int from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route = '/management/billing'),
  0,
  'and neither did the outsider — one gym cannot write another gym’s numbers'
);

-- ---------------------------------------------------------------------------
-- An id never reaches the column
-- ---------------------------------------------------------------------------

select lives_ok(
  format('select public.record_route_open(%L::uuid, %L)',
         current_setting('test.gym'),
         '/management/members/6b1f9e0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b'),
  'a route carrying a member id is recorded'
);

-- The whole privacy argument rests on this. The client collapses it too;
-- the server does it again because a client is not where a privacy rule
-- is enforced.
select is(
  (select count(*)::int from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route = '/management/members/[id]'),
  1,
  'as the pattern, not the member — the id is gone before it is stored'
);

select is(
  (select count(*)::int from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route ~ '[0-9a-f]{8}-[0-9a-f]{4}'),
  0,
  'and no row anywhere holds a uuid'
);

-- ---------------------------------------------------------------------------
-- Who may read it back
-- ---------------------------------------------------------------------------

select isnt(
  (select count(*)::int from public.gym_route_usage(
     current_setting('test.gym')::uuid, 90)),
  0,
  'an owner can read the usage back'
);

select _test_act_as(current_setting('test.out')::uuid);

select throws_ok(
  format('select * from public.gym_route_usage(%L::uuid, 90)',
         current_setting('test.gym')),
  null, 'Not authorised',
  'somebody from another gym cannot'
);

-- ---------------------------------------------------------------------------
-- The gym's day
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select day from public.route_opens
     where gym_id = current_setting('test.gym')::uuid
       and route = '/management/members'),
  (now() at time zone 'Australia/Sydney')::date,
  'the day is the gym''s, not the server''s'
);

select * from finish();
rollback;
