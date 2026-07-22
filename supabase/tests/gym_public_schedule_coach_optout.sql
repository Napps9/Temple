-- Coach-name opt-out on the public schedule (0159): when the site setting
-- showCoachNames is false, gym_public_schedule must return coach_name as
-- null from the RPC itself (not merely hide it in the renderer). Exercised
-- as anon. A control gym with the setting unset still returns the name.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner_h uuid := _test_mk_user('owner@sched-hide.test');
  v_coach_h uuid := _test_mk_user('coach@sched-hide.test');
  v_owner_s uuid := _test_mk_user('owner@sched-show.test');
  v_coach_s uuid := _test_mk_user('coach@sched-show.test');
  v_hide uuid := _test_mk_gym('Sched Hide', 'sched-hide');
  v_show uuid := _test_mk_gym('Sched Show', 'sched-show');
begin
  perform _test_mk_membership(v_hide, v_owner_h, 'owner');
  perform _test_mk_membership(v_hide, v_coach_h, 'coach');
  perform _test_mk_membership(v_show, v_owner_s, 'owner');
  perform _test_mk_membership(v_show, v_coach_s, 'coach');
  update public.gyms set website_builder_enabled = true where id in (v_hide, v_show);

  -- Hide gym: published with showCoachNames=false.
  insert into public.gym_websites (gym_id, theme, design, published, published_design, published_at)
  values (v_hide, 'forged',
    '{"version":2,"settings":{"themeId":"forged","showCoachNames":false},"pages":[]}'::jsonb, true,
    '{"version":2,"settings":{"themeId":"forged","showCoachNames":false},"pages":[]}'::jsonb, now());
  -- Show gym: setting unset (default show).
  insert into public.gym_websites (gym_id, theme, design, published, published_design, published_at)
  values (v_show, 'forged',
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, true,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, now());

  -- Give the named coach the session so the name would show if not hidden.
  update public.profiles set full_name = 'Hidden Coach' where id = v_coach_h;
  update public.profiles set full_name = 'Shown Coach'  where id = v_coach_s;
  perform _test_mk_session(v_hide, v_coach_h, now() + interval '1 day');
  perform _test_mk_session(v_show, v_coach_s, now() + interval '1 day');
end $$;

do $$ begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. Hidden: coach_name comes back null.
select is(
  (select coach_name from public.gym_public_schedule('sched-hide')),
  null, 'coach_name is null when showCoachNames is false');

-- 2. Shown (control): the name is present.
select is(
  (select coach_name from public.gym_public_schedule('sched-show')),
  'Shown Coach', 'coach_name is returned when the setting is unset');

select * from finish();
rollback;
