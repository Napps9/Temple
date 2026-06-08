-- Only a caller with can_configure_leaderboards (owner by default)
-- can flip the gym's leaderboard toggles.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cfg.test');
  v_coach uuid := _test_mk_user('coach@cfg.test');
  v_gym   uuid := _test_mk_gym('Cfg Gym', 'cfg-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- Coach (no can_configure_leaderboards by default) is blocked.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select throws_like(
  $$ select public.set_leaderboard_config(
       current_setting('test.gym')::uuid, false, true) $$,
  '%Not authorised%',
  'coach cannot set leaderboard config'
);

-- Owner can.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.set_leaderboard_config(current_setting('test.gym')::uuid, false, true);
end;
$$;

select is(
  (select class_leaderboards_enabled
    from public.gyms
    where id = current_setting('test.gym')::uuid)::boolean,
  false,
  'owner can flip class_leaderboards_enabled off'
);

select * from finish();
rollback;
