-- v1 invariant: one active gym membership per account.
--   - create_gym refuses when the caller already belongs to a gym.
--   - join_gym_by_slug refuses cross-gym joins for active members.
--   - Re-joining the SAME gym after leaving still works (left_at reset).

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_a    uuid := _test_mk_user('a@onegym.test');
  v_b    uuid := _test_mk_user('b@onegym.test');
  v_gym2 uuid := _test_mk_gym('Other Gym', 'other-gym');
begin
  -- gym2 exists with public signup on (default true from 0030).
  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);
  perform set_config('test.gym2', v_gym2::text, true);
end;
$$;

-- A creates their first gym — allowed.
do $$
declare
  v_gym uuid;
begin
  perform _test_act_as(current_setting('test.a')::uuid);
  v_gym := public.create_gym('First Gym', 'first-gym');
  perform set_config('test.gym1', v_gym::text, true);
end;
$$;

select is(
  (select count(*) from public.gym_memberships
    where profile_id = current_setting('test.a')::uuid
      and left_at is null)::int,
  1,
  'creating a first gym gives exactly one active membership'
);

-- A creating a SECOND gym — blocked.
select throws_like(
  $$ select public.create_gym('Second Gym', 'second-gym') $$,
  '%already belong to a gym%',
  'create_gym refuses a second gym for an active member'
);

-- A joining a different gym by slug — blocked.
select throws_like(
  $$ select public.join_gym_by_slug('other-gym') $$,
  '%already belong to a gym%',
  'join_gym_by_slug refuses cross-gym joins for active members'
);

-- B joins gym2, leaves, rejoins — the same-gym path stays open.
do $$
begin
  perform _test_act_as(current_setting('test.b')::uuid);
  perform public.join_gym_by_slug('other-gym');
  -- The "leave" write needs to bypass RLS (members don't direct-update
  -- their membership row in prod — a leave RPC does it).
  execute 'reset role';
  update public.gym_memberships
    set left_at = now()
    where profile_id = current_setting('test.b')::uuid;
  perform _test_act_as(current_setting('test.b')::uuid);
  perform public.join_gym_by_slug('other-gym');
end;
$$;

select is(
  (select count(*) from public.gym_memberships
    where profile_id = current_setting('test.b')::uuid
      and left_at is null)::int,
  1,
  'leaving then re-joining the same gym reactivates the one membership'
);

select * from finish();
rollback;
