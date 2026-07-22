-- gym_public_team hide-list enforcement (0157): a staff member listed in the
-- Team block's hiddenMemberIds must not be returned by the RPC itself — not
-- merely dropped by the renderer. Exercised as the real anon role, which also
-- proves the anon EXECUTE grant and the SECURITY DEFINER RLS bypass.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@team.test');
  v_vis    uuid := _test_mk_user('coach-visible@team.test');
  v_hidden uuid := _test_mk_user('coach-hidden@team.test');
  v_gym    uuid := _test_mk_gym('Team Gym', 'team-hide-gym');
  v_design jsonb;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_vis, 'coach');
  perform _test_mk_membership(v_gym, v_hidden, 'coach');
  update public.gyms set website_builder_enabled = true where id = v_gym;

  v_design := jsonb_build_object(
    'version', 2,
    'settings', jsonb_build_object('themeId', 'forged'),
    'pages', jsonb_build_array(jsonb_build_object(
      'id', 'p', 'slug', '', 'title', 'Home',
      'blocks', jsonb_build_array(jsonb_build_object(
        'id', 't', 'type', 'team', 'heading', 'Team',
        'hiddenMemberIds', jsonb_build_array(v_hidden::text)
      ))
    ))
  );

  -- Published, with the snapshot the public RPC reads from.
  insert into public.gym_websites (gym_id, theme, design, published, published_design, published_at)
  values (v_gym, 'forged', v_design, true, v_design, now());

  perform set_config('test.hidden', v_hidden::text, true);
  perform set_config('test.vis',    v_vis::text,    true);
end $$;

-- Become anonymous.
do $$ begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. Owner + visible coach remain; hidden coach is gone (3 staff, 1 hidden).
select is(
  (select count(*)::int from public.gym_public_team('team-hide-gym')),
  2, 'the hidden staff member is excluded from the public team RPC');

-- 2. The hidden member specifically is absent.
select is(
  (select count(*)::int from public.gym_public_team('team-hide-gym')
     where profile_id = current_setting('test.hidden')::uuid),
  0, 'the hidden member id is not returned to anon');

-- 3. A non-hidden coach is still present.
select is(
  (select count(*)::int from public.gym_public_team('team-hide-gym')
     where profile_id = current_setting('test.vis')::uuid),
  1, 'a non-hidden coach is still returned');

select * from finish();
rollback;
