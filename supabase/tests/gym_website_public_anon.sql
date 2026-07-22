-- Public website RPCs exercised as the real anon role (finding: no test
-- previously ran them as anon, so a regression revoking the grant or the
-- SECURITY DEFINER would have passed CI). Also asserts cross-tenant
-- isolation across all four RPCs, and that a verified custom domain on an
-- UNPUBLISHED site resolves its slug but still serves nothing.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner_a uuid := _test_mk_user('owner@anon-a.test');
  v_coach_a uuid := _test_mk_user('coach@anon-a.test');
  v_owner_b uuid := _test_mk_user('owner@anon-b.test');
  v_owner_c uuid := _test_mk_user('owner@anon-c.test');
  v_a uuid := _test_mk_gym('Anon A', 'anon-a');
  v_b uuid := _test_mk_gym('Anon B', 'anon-b');
  v_c uuid := _test_mk_gym('Anon C', 'anon-c');
  v_sess_a uuid;
begin
  perform _test_mk_membership(v_a, v_owner_a, 'owner');
  perform _test_mk_membership(v_a, v_coach_a, 'coach');
  perform _test_mk_membership(v_b, v_owner_b, 'owner');
  perform _test_mk_membership(v_c, v_owner_c, 'owner');
  update public.gyms set website_builder_enabled = true where id in (v_a, v_b, v_c);

  -- A and B publish; C stays a draft.
  insert into public.gym_websites (gym_id, theme, design, published, published_design, published_at)
  values
    (v_a, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, true,
     '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, now()),
    (v_b, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, true,
     '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, now());
  insert into public.gym_websites (gym_id, theme, design)
  values (v_c, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb);

  -- One session + plan per gym (A and B), so cross-tenant leakage would show.
  v_sess_a := _test_mk_session(v_a, v_coach_a, now() + interval '1 day');
  perform _test_mk_session(v_b, v_owner_b, now() + interval '1 day');
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_a, 'A Plan', 'unlimited', 5000), (v_b, 'B Plan', 'unlimited', 6000);

  -- C has a verified custom domain despite being unpublished.
  insert into public.gym_website_domains (gym_id, domain, status, verified_at)
  values (v_c, 'ccustom.example', 'verified', now());

  perform set_config('test.a',      v_a::text,      true);
  perform set_config('test.sess_a', v_sess_a::text, true);
end $$;

-- Become anonymous — every assertion below runs as the anon role.
do $$ begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. by_slug works as anon and returns the right gym.
select is(
  (select gym_id from public.gym_website_by_slug('anon-a')),
  current_setting('test.a')::uuid,
  'gym_website_by_slug returns the correct gym to an anonymous caller');

-- 2. by_slug is single-tenant.
select is(
  (select count(*)::int from public.gym_website_by_slug('anon-a')),
  1, 'gym_website_by_slug returns exactly one row for a published slug');

-- 3. schedule returns only this gym's session.
select is(
  (select count(*)::int from public.gym_public_schedule('anon-a')),
  1, 'gym_public_schedule returns only the queried gym''s sessions');
select is(
  (select session_id from public.gym_public_schedule('anon-a')),
  current_setting('test.sess_a')::uuid,
  'the schedule session belongs to gym A, not gym B');

-- 4. plans are single-tenant.
select is(
  (select name from public.gym_public_plans('anon-a')),
  'A Plan', 'gym_public_plans returns only gym A''s plan');

-- 5. team is single-tenant (owner + coach = 2).
select is(
  (select count(*)::int from public.gym_public_team('anon-a')),
  2, 'gym_public_team returns only gym A''s staff');

-- 6. An unpublished site serves nothing, even with a verified domain.
select is(
  (select count(*)::int from public.gym_website_by_slug('anon-c')),
  0, 'an unpublished site is not served even though its domain is verified');

-- 7. ...but the domain itself still resolves (the publish gate is the second hop).
select is(
  public.gym_slug_for_domain('ccustom.example'),
  'anon-c', 'a verified domain resolves its slug; the publish check happens downstream');

select * from finish();
rollback;
