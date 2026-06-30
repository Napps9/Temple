-- RLS isolation for tracked_group_favourites: a member can star and read
-- back their own groups, but cannot see another member's group stars.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_a   uuid := _test_mk_user('a@gfav.test');
  v_b   uuid := _test_mk_user('b@gfav.test');
  v_gym uuid := _test_mk_gym('GFav Gym', 'gfav-gym');
begin
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  perform _test_act_as(v_b);
  insert into public.tracked_group_favourites (profile_id, group_key)
    values (v_b, 'squats');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);
end;
$$;

do $$ begin perform _test_act_as(current_setting('test.b')::uuid); end; $$;
select is(
  (select count(*) from public.tracked_group_favourites)::int,
  1,
  'member B can read back their own starred group'
);

select lives_ok(
  $$ insert into public.tracked_group_favourites (profile_id, group_key)
       values (current_setting('test.b')::uuid, 'pulling') $$,
  'member B can star another group'
);

do $$ begin perform _test_act_as(current_setting('test.a')::uuid); end; $$;
select is(
  (select count(*) from public.tracked_group_favourites)::int,
  0,
  'member A cannot SELECT member B''s starred groups'
);

select * from finish();
rollback;
