-- gym_public_team (0100): SECURITY DEFINER, bypasses gym_memberships/
-- profiles RLS entirely, so the two things that actually matter to
-- test are (1) it refuses to expose anything for a gym with no
-- published site, same as its siblings gym_public_schedule/
-- gym_public_plans, and (2) its role/left_at filtering is correct —
-- a plain member or someone who's left the gym must never appear in
-- a public staff roster.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner       uuid := _test_mk_user('owner@teamdata.test');
  v_coach       uuid := _test_mk_user('coach@teamdata.test');
  v_member      uuid := _test_mk_user('member@teamdata.test');
  v_left_coach  uuid := _test_mk_user('left-coach@teamdata.test');
  v_gym         uuid := _test_mk_gym('Team Data Gym', 'team-data-gym');
  v_left_membership uuid;
begin
  update public.profiles set full_name = 'Olivia Owner' where id = v_owner;
  update public.profiles set full_name = 'Cara Coach' where id = v_coach;
  update public.profiles set full_name = 'Mia Member' where id = v_member;
  update public.profiles set full_name = 'Left Coach' where id = v_left_coach;

  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  v_left_membership := _test_mk_membership(v_gym, v_left_coach, 'coach');
  update public.gym_memberships set left_at = now() where id = v_left_membership;

  perform set_config('test.gym', v_gym::text, true);
end $$;

-- 1. No published site yet — nothing returned, even though the
-- memberships exist.
select is(
  (select count(*)::int from public.gym_public_team('team-data-gym')),
  0,
  'gym_public_team returns nothing before the site is published'
);

-- 2. Publish the site (bypasses RLS as the test superuser — still
-- before any _test_act_as call in this file).
do $$ begin
  insert into public.gym_websites (gym_id, published)
    values (current_setting('test.gym')::uuid, true);
end $$;

-- 3. Owner + active coach only — plain member and left coach excluded.
select is(
  (select count(*)::int from public.gym_public_team('team-data-gym')),
  2,
  'gym_public_team returns only owner/admin/coach/staff who have not left'
);

-- 4. The plain member never appears.
select is(
  (select count(*)::int from public.gym_public_team('team-data-gym') where full_name = 'Mia Member'),
  0,
  'a plain member is excluded from the public team roster'
);

-- 5. The left coach never appears.
select is(
  (select count(*)::int from public.gym_public_team('team-data-gym') where full_name = 'Left Coach'),
  0,
  'a coach who has left the gym is excluded from the public team roster'
);

-- 6. Owner's name round-trips, and role priority orders it first.
select is(
  (select full_name from public.gym_public_team('team-data-gym') limit 1),
  'Olivia Owner',
  'the owner sorts first and their name round-trips correctly'
);

select * from finish();
rollback;
