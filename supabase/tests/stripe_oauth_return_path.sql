-- The Stripe OAuth state row carries where to return to (0210). The
-- CHECK is the open-redirect guard: the callback appends this to a
-- trusted origin, so it must stay a path — one leading slash, no scheme,
-- no protocol-relative '//host'.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@oauthpath.test');
  v_gym   uuid := _test_mk_gym('OAuth Gym', 'oauth-path-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym', v_gym::text, true);
end $$;

select is(
  (select return_path from (
     insert into public.stripe_oauth_states (state, gym_id, origin)
     values ('s-default', current_setting('test.gym')::uuid, 'https://app.example')
     returning return_path
   ) t),
  '/management/billing',
  'existing callers keep the billing screen without changing'
);

select lives_ok(
  $$ insert into public.stripe_oauth_states (state, gym_id, origin, return_path)
     values ('s-setup', current_setting('test.gym')::uuid, 'https://app.example', '/setup') $$,
  'setup can ask to be returned to the conversation'
);

-- The three shapes that would turn the redirect into someone else's site.
select throws_ok(
  $$ insert into public.stripe_oauth_states (state, gym_id, origin, return_path)
     values ('s-proto', current_setting('test.gym')::uuid, 'https://app.example', '//evil.example') $$,
  23514,
  null,
  'a protocol-relative path is refused'
);

select throws_ok(
  $$ insert into public.stripe_oauth_states (state, gym_id, origin, return_path)
     values ('s-abs', current_setting('test.gym')::uuid, 'https://app.example', 'https://evil.example') $$,
  23514,
  null,
  'an absolute URL is refused'
);

select throws_ok(
  $$ insert into public.stripe_oauth_states (state, gym_id, origin, return_path)
     values ('s-space', current_setting('test.gym')::uuid, 'https://app.example', '/setup evil') $$,
  23514,
  null,
  'whitespace is refused'
);

select throws_ok(
  $$ insert into public.stripe_oauth_states (state, gym_id, origin, return_path)
     values ('s-long', current_setting('test.gym')::uuid, 'https://app.example',
             '/' || repeat('a', 200)) $$,
  23514,
  null,
  'an over-long path is refused'
);

select * from finish();
rollback;
