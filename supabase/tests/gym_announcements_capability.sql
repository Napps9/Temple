-- Posting an announcement requires can_post_announcements (default-on
-- for owner / admin / coach). A member is blocked.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@ann.test');
  v_coach uuid := _test_mk_user('coach@ann.test');
  v_m     uuid := _test_mk_user('m@ann.test');
  v_gym   uuid := _test_mk_gym('Ann Gym', 'ann-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_m,     'member');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.m',     v_m::text,     true);
end;
$$;

-- Coach can post.
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select lives_ok(
  $$ insert into public.gym_announcements
       (gym_id, posted_by, title, body)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.coach')::uuid,
        'Closed Monday',
        'Cleaning the floor.')
  $$,
  'coach can post a gym announcement by default'
);

-- Member cannot post.
do $$
begin
  perform _test_act_as(current_setting('test.m')::uuid);
end;
$$;

select throws_like(
  $$ insert into public.gym_announcements
       (gym_id, posted_by, title, body)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.m')::uuid,
        'Cookies',
        'I have some.')
  $$,
  '%row-level security%',
  'member cannot post a gym announcement'
);

select * from finish();
rollback;
