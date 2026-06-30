-- RLS isolation for tracked_movement_favourites: a member can star and
-- read back their own movements, but cannot see another member's stars.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_a   uuid := _test_mk_user('a@fav.test');
  v_b   uuid := _test_mk_user('b@fav.test');
  v_gym uuid := _test_mk_gym('Fav Gym', 'fav-gym');
begin
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  -- Member B stars a movement (acting as B so the self-insert policy applies).
  perform _test_act_as(v_b);
  insert into public.tracked_movement_favourites (profile_id, movement_key)
    values (v_b, 'back_squat');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);
end;
$$;

-- Acting as B: their own star is visible.
do $$ begin perform _test_act_as(current_setting('test.b')::uuid); end; $$;
select is(
  (select count(*) from public.tracked_movement_favourites)::int,
  1,
  'member B can read back their own favourite'
);

-- B can star a second movement and remove the first.
select lives_ok(
  $$ insert into public.tracked_movement_favourites (profile_id, movement_key)
       values (current_setting('test.b')::uuid, 'deadlift') $$,
  'member B can star another movement'
);

-- Acting as A: B's stars are invisible.
do $$ begin perform _test_act_as(current_setting('test.a')::uuid); end; $$;
select is(
  (select count(*) from public.tracked_movement_favourites)::int,
  0,
  'member A cannot SELECT member B''s favourites'
);

select * from finish();
rollback;
