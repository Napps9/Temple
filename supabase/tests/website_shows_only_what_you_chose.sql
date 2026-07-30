-- The website only shows what you chose (0220).
--
-- The assertion that matters is the second one. Hiding a plan from the
-- pricing block hid it from the rendered page and not from the server,
-- and the anon key is embedded in that page — so the plan's name, kind,
-- credits and price were one request away from any visitor. This proves
-- the server now honours the same list the renderer does.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@websec.test');
  v_gym   uuid := _test_mk_gym('Web Sec', 'websec');
  v_shown uuid;
  v_hidden uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_shown;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Staff rate', 'unlimited', 1000) returning plan_id into v_hidden;

  -- A published site whose pricing block hides the staff rate, exactly as
  -- the editor writes it.
  insert into public.gym_websites (gym_id, theme, design, published, published_design)
  values (
    v_gym, 'temple',
    jsonb_build_object(
      'version', 1,
      'pages', jsonb_build_array(jsonb_build_object(
        'id', 'home', 'title', 'Home', 'slug', '',
        'blocks', jsonb_build_array(jsonb_build_object(
          'id', 'p1', 'type', 'pricing', 'heading', 'Membership',
          'hiddenPlanIds', jsonb_build_array(v_hidden::text)
        ))
      ))
    ),
    true,
    jsonb_build_object(
      'version', 1,
      'pages', jsonb_build_array(jsonb_build_object(
        'id', 'home', 'title', 'Home', 'slug', '',
        'blocks', jsonb_build_array(jsonb_build_object(
          'id', 'p1', 'type', 'pricing', 'heading', 'Membership',
          'hiddenPlanIds', jsonb_build_array(v_hidden::text)
        ))
      ))
    )
  );

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.shown',  v_shown::text,  true);
  perform set_config('test.hidden', v_hidden::text, true);
end;
$$;

-- ============================================================================
-- What a visitor gets
-- ============================================================================

select is(
  (select count(*)::int from public.gym_public_plans('websec')),
  1,
  'a visitor sees the plans on the page and no others'
);

select is(
  (select name from public.gym_public_plans('websec')),
  'Unlimited',
  'and the one they were shown is the one that is not hidden — before 0220 the staff rate came back too'
);

select is(
  (select count(*)::int from public.gym_public_plans('websec')
    where plan_id = current_setting('test.hidden')::uuid),
  0,
  'the hidden plan is absent by id, not merely renamed'
);

-- An unpublished site still shows nothing at all, which 0098 already did
-- and this must not have broken.
do $$ begin
  update public.gym_websites set published = false
    where gym_id = current_setting('test.gym')::uuid;
end $$;

select is(
  (select count(*)::int from public.gym_public_plans('websec')),
  0,
  'and an unpublished site still shows nothing'
);

-- ============================================================================
-- Only the RPCs publish
-- ============================================================================

select ok(
  not has_table_privilege('authenticated', 'public.gym_websites', 'update'),
  'authenticated cannot UPDATE gym_websites directly — publishing without a snapshot was one PATCH away'
);

select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.gym_websites'::regclass and polcmd = 'w'),
  0,
  'and the policy that guarded that door went with the grant'
);

select finish();
rollback;
