-- 0267: membership_episodes is the history rejoin_gym would otherwise
-- overwrite, and compute_member_tenure reports both halves of it.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@stay.test');
  v_a     uuid := _test_mk_user('ann@stay.test');
  v_b     uuid := _test_mk_user('ben@stay.test');
  v_c     uuid := _test_mk_user('cat@stay.test');
  v_gym   uuid := _test_mk_gym('Stay Gym', 'stay-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');
  perform _test_mk_membership(v_gym, v_c, 'member');

  -- Ann joined 400 days ago and left after 300.
  update public.gym_memberships
     set created_at = now() - interval '400 days'
   where gym_id = v_gym and profile_id = v_a;
  update public.membership_episodes
     set joined_at = now() - interval '400 days'
   where gym_id = v_gym and profile_id = v_a;
  update public.gym_memberships
     set left_at = now() - interval '100 days'
   where gym_id = v_gym and profile_id = v_a;

  -- Ben has been here 200 days and is still here.
  update public.gym_memberships
     set created_at = now() - interval '200 days'
   where gym_id = v_gym and profile_id = v_b;
  update public.membership_episodes
     set joined_at = now() - interval '200 days'
   where gym_id = v_gym and profile_id = v_b;

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.owner', v_owner::text, false);
  perform set_config('test.ann', v_a::text, false);
  perform set_config('test.cat', v_c::text, false);
end $$;

-- 1. The backfill and the insert trigger agree: one episode per member.
select is(
  (select count(*)::int from public.membership_episodes
    where gym_id = current_setting('test.gym')::uuid),
  4,
  'one episode per membership, owner included'
);

-- 2. Leaving closed the open episode rather than opening a second.
select is(
  (select count(*)::int from public.membership_episodes
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.ann')::uuid),
  1,
  'a departure closes the stay, it does not open another'
);

-- 3. And it recorded when.
select ok(
  (select left_at is not null from public.membership_episodes
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.ann')::uuid),
  'the closed stay carries its leaving date'
);

-- 4-5. A rejoin opens a second episode and leaves the first alone —
-- this is the history gym_memberships.left_at cannot hold.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format('select public.rejoin_gym(%L, %L)',
         current_setting('test.gym'), current_setting('test.ann')),
  'a member can rejoin'
);

select is(
  (select count(*)::int from public.membership_episodes
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.ann')::uuid),
  2,
  'a rejoin opens a second stay, the first keeps its dates'
);

-- 6-7. Both halves of the answer, to the owner.
select _test_act_as(current_setting('test.owner')::uuid);
select is(
  (select departed_count from public.compute_member_tenure(
     current_setting('test.gym')::uuid)),
  1,
  'one completed stay is counted'
);

select is(
  (select median_days_left from public.compute_member_tenure(
     current_setting('test.gym')::uuid)),
  300,
  'the completed stay is measured from its own joining date'
);

-- 8. A member cannot read the gym's numbers.
select _test_act_as(current_setting('test.cat')::uuid);
select throws_ok(
  format('select * from public.compute_member_tenure(%L)',
         current_setting('test.gym')),
  'Not authorised',
  'tenure is insights, not roster data'
);

select * from finish();
rollback;
