-- join_gym_by_slug: works when public_signup_enabled = true; fails
-- when the owner has flipped it off.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@js.test');
  v_visitor uuid := _test_mk_user('visitor@js.test');
  v_gym     uuid;
begin
  perform _test_act_as(v_owner);
  v_gym := public.create_gym('Join Gym', 'join-gym');
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.visitor', v_visitor::text, true);
  perform set_config('test.gym',     v_gym::text,     true);
end;
$$;

-- Visitor can join the default (public_signup_enabled = true) gym.
do $$
begin
  perform _test_act_as(current_setting('test.visitor')::uuid);
  perform public.join_gym_by_slug('join-gym');
end;
$$;

select is(
  (select role::text from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.visitor')::uuid),
  'member',
  'visitor joins as member when public_signup_enabled is true'
);

-- Owner flips it off; subsequent joins fail.
do $$
declare
  v_other uuid := _test_mk_user('other@js.test');
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.set_gym_public_signup(current_setting('test.gym')::uuid, false);
  perform set_config('test.other', v_other::text, true);
  perform _test_act_as(v_other);
end;
$$;

select throws_like(
  $$ select public.join_gym_by_slug('join-gym') $$,
  '%Public signup is disabled%',
  'second visitor is blocked once public signup is disabled'
);

select * from finish();
rollback;
