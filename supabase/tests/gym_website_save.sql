-- save_gym_website server-side validation (0156): unknown theme, oversize
-- document, and non-http(s) image URLs are rejected; a stale optimistic-
-- concurrency token conflicts; the capability-override path lets a coach
-- save; a plain member cannot; and a disabled gym is refused.
--
-- Fixture writes happen in the setup block before any role switch.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner     uuid := _test_mk_user('owner@save.test');
  v_coach     uuid := _test_mk_user('coach@save.test');
  v_member    uuid := _test_mk_user('member@save.test');
  v_off_owner uuid := _test_mk_user('owner@saveoff.test');
  v_gym       uuid := _test_mk_gym('Save Gym', 'save-gym');
  v_off       uuid := _test_mk_gym('Save Off Gym', 'save-off-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_off, v_off_owner, 'owner');

  update public.gyms set website_builder_enabled = true where id in (v_gym, v_off);

  insert into public.gym_websites (gym_id, theme, design)
  values (v_gym, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb);
  insert into public.gym_websites (gym_id, theme, design)
  values (v_off, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb);
  update public.gyms set website_builder_enabled = false where id = v_off;

  -- Per-gym override: this gym's coaches may manage the website.
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (v_gym, 'coach', 'can_manage_website', true);

  perform set_config('test.gym',       v_gym::text,       true);
  perform set_config('test.off',       v_off::text,       true);
  perform set_config('test.owner',     v_owner::text,     true);
  perform set_config('test.coach',     v_coach::text,     true);
  perform set_config('test.member',    v_member::text,    true);
  perform set_config('test.off_owner', v_off_owner::text, true);
end $$;

-- Act as the owner for the validation checks.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 1. Unknown theme.
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"nope"},"pages":[]}'::jsonb, 'nope', null) $$,
    current_setting('test.gym')),
  null, null, 'save rejects an unknown theme id');

-- 2. Oversize design.
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    ('{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"p","slug":"","title":"'
      || repeat('x', 600000) || '","blocks":[]}]}')::jsonb, 'forged', null) $$,
    current_setting('test.gym')),
  null, null, 'save rejects a design larger than the size cap');

-- 3. javascript: image URL.
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"p","slug":"","title":"Home","blocks":[{"id":"b","type":"hero","imageUrl":"javascript:alert(1)"}]}]}'::jsonb,
    'forged', null) $$, current_setting('test.gym')),
  null, null, 'save rejects a javascript: image URL');

-- 4. data: gallery image URL (nested images[].url).
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"p","slug":"","title":"Home","blocks":[{"id":"g","type":"gallery","images":[{"id":"i","url":"data:text/html,x","alt":""}]}]}]}'::jsonb,
    'forged', null) $$, current_setting('test.gym')),
  null, null, 'save rejects a data: URL nested in a gallery block');

-- 5. Valid save returns a fresh updated_at.
select ok(
  (select public.save_gym_website(current_setting('test.gym')::uuid,
    '{"version":2,"settings":{"themeId":"ringside"},"pages":[{"id":"p","slug":"","title":"Home","blocks":[{"id":"b","type":"hero","imageUrl":"https://cdn.example.com/x.jpg"}]}]}'::jsonb,
    'ringside', null)) is not null,
  'a valid save succeeds and returns the new updated_at');

-- 6. Stale concurrency token conflicts.
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb,
    'forged', '2000-01-01T00:00:00Z'::timestamptz) $$, current_setting('test.gym')),
  null, null, 'save rejects a stale optimistic-concurrency token');

-- 7. Capability override — a coach granted can_manage_website can save.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select ok(
  (select public.save_gym_website(current_setting('test.gym')::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, 'forged', null)) is not null,
  'a coach with a can_manage_website override can save');

-- 8. A plain member cannot save.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, 'forged', null) $$,
    current_setting('test.gym')),
  null, null, 'a plain member cannot save');

-- 9. A disabled gym is refused even for its owner.
do $$ begin perform _test_act_as(current_setting('test.off_owner')::uuid); end $$;
select throws_ok(
  format($$ select public.save_gym_website(%L::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb, 'forged', null) $$,
    current_setting('test.off')),
  null, null, 'save is refused when website_builder_enabled is false');

select * from finish();
rollback;
