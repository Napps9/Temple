-- Custom domains (0099): gym_website_domains is read-gated on
-- can_manage_website + website_builder_enabled, tenant-isolated, has NO
-- client write path (every write happens in the custom-domain edge
-- function under the service role), the domain column is globally
-- unique, and gym_slug_for_domain only ever resolves a verified domain.
--
-- The unique-domain check happens inside the setup block (before any
-- _test_act_as switch), same reasoning as gym_website_builder.sql: RESET
-- ROLE doesn't reliably undo _test_act_as's set_config mid-transaction,
-- so any RLS-bypassing fixture work has to happen up front.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner     uuid := _test_mk_user('owner@cd.test');
  v_coach     uuid := _test_mk_user('coach@cd.test');
  v_member    uuid := _test_mk_user('member@cd.test');
  v_adminb    uuid := _test_mk_user('adminb@cd.test');
  v_off_owner uuid := _test_mk_user('owner@cdoff.test');
  v_gyma      uuid := _test_mk_gym('CD Gym A', 'cd-gym-a');
  v_gymb      uuid := _test_mk_gym('CD Gym B', 'cd-gym-b');
  v_off       uuid := _test_mk_gym('CD Disabled Gym', 'cd-disabled-gym');
  v_verified  uuid := _test_mk_gym('CD Verified Gym', 'cd-verified-gym');
  v_dup       uuid := _test_mk_gym('CD Dup Gym', 'cd-dup-gym');
begin
  perform _test_mk_membership(v_gyma, v_owner,  'owner');
  perform _test_mk_membership(v_gyma, v_coach,  'coach');
  perform _test_mk_membership(v_gyma, v_member, 'member');
  perform _test_mk_membership(v_gymb, v_adminb, 'admin');
  perform _test_mk_membership(v_off, v_off_owner, 'owner');

  update public.gyms set website_builder_enabled = true
    where id in (v_gyma, v_gymb, v_verified, v_dup);
  -- v_off is explicitly disabled (the default is true since 0153).
  update public.gyms set website_builder_enabled = false where id = v_off;

  -- Seed rows directly (bypasses RLS as the test superuser) — the edge
  -- function is what would normally write these.
  insert into public.gym_website_domains (gym_id, domain, status)
    values (v_gyma, 'cd-gym-a.example', 'pending');
  insert into public.gym_website_domains (gym_id, domain, status)
    values (v_off, 'cd-off.example', 'pending');
  insert into public.gym_website_domains (gym_id, domain, status)
    values (v_verified, 'cd-verified.example', 'verified');

  -- Unique-domain check: a second gym cannot claim a domain another gym
  -- already holds. Captured here (superuser context) rather than as a
  -- numbered assertion, then asserted on below via test.dup_domain_blocked.
  begin
    insert into public.gym_website_domains (gym_id, domain, status)
      values (v_dup, 'cd-gym-a.example', 'pending');
    perform set_config('test.dup_domain_blocked', 'false', true);
  exception when unique_violation then
    perform set_config('test.dup_domain_blocked', 'true', true);
  end;

  perform set_config('test.gyma',      v_gyma::text,      true);
  perform set_config('test.owner',     v_owner::text,     true);
  perform set_config('test.coach',     v_coach::text,     true);
  perform set_config('test.member',    v_member::text,    true);
  perform set_config('test.adminb',    v_adminb::text,    true);
  perform set_config('test.off_owner', v_off_owner::text, true);
end;
$$;

-- 1. A member cannot read it.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_website_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'a member cannot read the custom domain'
);

-- 2. A coach cannot either (can_manage_website is admin-only by default).
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_website_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'a coach cannot read the custom domain'
);

-- 3. The owner can.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_website_domains
    where gym_id = current_setting('test.gyma')::uuid),
  1,
  'an owner can read their gym''s custom domain'
);

-- 4. An admin of another gym cannot.
do $$ begin perform _test_act_as(current_setting('test.adminb')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_website_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'an admin of another gym cannot read this gym''s custom domain'
);

-- 5. Entitlement gate: even the owner of a gym with website_builder_enabled
-- off cannot read its domain row.
do $$ begin perform _test_act_as(current_setting('test.off_owner')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_website_domains),
  0,
  'a domain row is invisible while website_builder_enabled is false, even to the owner'
);

-- 6. No client write path: even the owner can't INSERT directly.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select throws_like(
  $$ insert into public.gym_website_domains (gym_id, domain)
     values (current_setting('test.gyma')::uuid, 'sneaky.example') $$,
  '%row-level security%',
  'a client INSERT is refused — writes only happen in the edge function'
);

-- 7. Unique domain constraint (checked in the setup block above).
select is(
  current_setting('test.dup_domain_blocked'),
  'true',
  'the same domain cannot be connected to two gyms'
);

-- 8. gym_slug_for_domain returns nothing for a domain still pending DNS.
select is(
  public.gym_slug_for_domain('cd-gym-a.example'),
  null,
  'gym_slug_for_domain returns nothing for a pending domain'
);

-- 9. gym_slug_for_domain resolves a verified domain to its gym's slug.
select is(
  public.gym_slug_for_domain('cd-verified.example'),
  'cd-verified-gym',
  'gym_slug_for_domain resolves a verified domain to the gym''s slug'
);

select * from finish();
rollback;
