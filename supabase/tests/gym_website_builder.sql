-- Site builder (0097): can_manage_website capability defaults, the
-- website_builder_enabled entitlement gate on gym_websites RLS, tenant
-- isolation, and gym_website_by_slug only ever surfacing published sites.
--
-- All RLS-bypassing fixture writes (creating gyms/memberships, and
-- flipping website_builder_enabled — which has no owner-facing setter
-- RPC by design) happen in the single setup block below, before any
-- _test_act_as call switches role. RESET ROLE doesn't reliably undo
-- that switch within one transaction (see _helpers.psql / CLAUDE.md),
-- so nothing here relies on resetting back to a bypass role mid-test.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner       uuid := _test_mk_user('owner@site.test');
  v_admin       uuid := _test_mk_user('admin@site.test');
  v_coach       uuid := _test_mk_user('coach@site.test');
  v_off_owner   uuid := _test_mk_user('owner@offsite.test');
  v_other_owner uuid := _test_mk_user('owner@othersite.test');
  v_gym         uuid := _test_mk_gym('Site Gym', 'site-gym');
  v_off         uuid := _test_mk_gym('Disabled Gym', 'disabled-gym');
  v_other       uuid := _test_mk_gym('Other Gym', 'other-site-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_off, v_off_owner, 'owner');
  perform _test_mk_membership(v_other, v_other_owner, 'owner');

  -- v_gym has the entitlement on from the start; v_off stays at its
  -- default (false), used only for the "refused while disabled" check.
  update public.gyms set website_builder_enabled = true where id = v_gym;

  perform set_config('test.gym',         v_gym::text,         true);
  perform set_config('test.off',         v_off::text,         true);
  perform set_config('test.owner',       v_owner::text,       true);
  perform set_config('test.admin',       v_admin::text,       true);
  perform set_config('test.coach',       v_coach::text,       true);
  perform set_config('test.off_owner',   v_off_owner::text,   true);
  perform set_config('test.other_owner', v_other_owner::text, true);
end $$;

-- 1-3. Capability defaults.
select is(public.default_capability('admin', 'can_manage_website'), true,
  'admin manages the website by default');
select is(public.default_capability('coach', 'can_manage_website'), false,
  'a coach does not manage the website by default');
select is(public.default_capability('member', 'can_manage_website'), false,
  'a member never manages the website');

-- 4. Insert refused on a gym with the entitlement off, even for its owner.
do $$ begin perform _test_act_as(current_setting('test.off_owner')::uuid); end $$;
select throws_ok(
  format($$ insert into public.gym_websites (gym_id) values (%L::uuid) $$,
    current_setting('test.off')),
  null,
  null,
  'insert is refused while website_builder_enabled is false, even for the owner'
);

-- 5. Owner can create the site row once the gym is entitled.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select lives_ok(
  format($$ insert into public.gym_websites (gym_id) values (%L::uuid) $$,
    current_setting('test.gym')),
  'an owner can create the site row once the entitlement is on'
);

-- 6. Not published yet — gym_website_by_slug surfaces nothing.
select is(
  (select count(*)::int from public.gym_website_by_slug('site-gym')),
  0,
  'gym_website_by_slug returns nothing for a draft (unpublished) site'
);

-- 7. A coach without can_manage_website cannot update it. RLS's USING
-- clause silently excludes the row from the update (0 rows affected) —
-- unlike INSERT's WITH CHECK, a blocked UPDATE does not throw, so this
-- asserts the row is unaffected rather than expecting an exception.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
do $$ begin
  update public.gym_websites set published = true
    where gym_id = current_setting('test.gym')::uuid;
end $$;
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select is(
  (select published from public.gym_websites where gym_id = current_setting('test.gym')::uuid),
  false,
  'a coach''s update attempt has no effect — the site is still unpublished'
);

-- 8. An admin can update it (publish it).
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
do $$ begin
  update public.gym_websites set published = true, theme = 'ringside'
    where gym_id = current_setting('test.gym')::uuid;
end $$;
select is(
  (select published from public.gym_websites where gym_id = current_setting('test.gym')::uuid),
  true,
  'an admin can publish the site'
);

-- 9. Now published — gym_website_by_slug surfaces the theme.
select is(
  (select theme from public.gym_website_by_slug('site-gym')),
  'ringside',
  'gym_website_by_slug surfaces the published site with its theme'
);

-- 10. Tenant isolation: staff of a different gym see nothing for this one.
do $$ begin perform _test_act_as(current_setting('test.other_owner')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_websites where gym_id = current_setting('test.gym')::uuid),
  0,
  'a different gym''s owner cannot see this gym''s site row'
);

select * from finish();
rollback;
