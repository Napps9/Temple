-- DM scope: when set to 'member_coach_only', a member's INSERT to
-- another member is blocked, but member→coach succeeds. When set to
-- 'full_gym' (the default), both succeed.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@scope.test');
  v_coach uuid := _test_mk_user('coach@scope.test');
  v_a     uuid := _test_mk_user('a@scope.test');
  v_b     uuid := _test_mk_user('b@scope.test');
  v_gym   uuid := _test_mk_gym('Scope Gym', 'scope-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  -- Lock down the scope.
  update public.gyms set dm_scope = 'member_coach_only' where id = v_gym;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.coach', v_coach::text, true);
end;
$$;

-- Member A → Member B is blocked.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select throws_like(
  $$ insert into public.direct_messages
       (gym_id, sender_id, recipient_id, body)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.a')::uuid,
        current_setting('test.b')::uuid,
        'hey')
  $$,
  '%row-level security%',
  'member A cannot DM member B when scope is member_coach_only'
);

-- Member A → Coach is allowed.
select lives_ok(
  $$ insert into public.direct_messages
       (gym_id, sender_id, recipient_id, body)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.a')::uuid,
        current_setting('test.coach')::uuid,
        'have a question')
  $$,
  'member A can DM the coach'
);

-- Flip back to full_gym; member A → member B now works.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.set_dm_scope(current_setting('test.gym')::uuid, 'full_gym');
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select lives_ok(
  $$ insert into public.direct_messages
       (gym_id, sender_id, recipient_id, body)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.a')::uuid,
        current_setting('test.b')::uuid,
        'hello again')
  $$,
  'member A can DM member B once scope is back to full_gym'
);

select * from finish();
rollback;
