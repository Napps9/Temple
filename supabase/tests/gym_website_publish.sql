-- Site builder draft/publish separation (0156): editing the draft `design`
-- must not change what the public sees until publish snapshots it into
-- published_design; unpublish takes it offline; publish/unpublish are
-- authorised via capability; and the RLS entitlement fix blocks UPDATE and
-- DELETE on a gym whose website_builder_enabled is false.
--
-- All RLS-bypassing fixture writes happen in the setup block before any
-- _test_act_as switches role (RESET ROLE is unreliable mid-transaction —
-- see _helpers.psql). The two disabled-gym checks capture the affected-row
-- count via a CTE rather than reading the row back, since a disabled gym's
-- row is hidden from its own owner by the SELECT policy too.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner     uuid := _test_mk_user('owner@pub.test');
  v_admin     uuid := _test_mk_user('admin@pub.test');
  v_coach     uuid := _test_mk_user('coach@pub.test');
  v_off_owner uuid := _test_mk_user('owner@puboff.test');
  v_gym       uuid := _test_mk_gym('Pub Gym', 'pub-gym');
  v_off       uuid := _test_mk_gym('Pub Off Gym', 'pub-off-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_off, v_off_owner, 'owner');

  update public.gyms set website_builder_enabled = true where id in (v_gym, v_off);

  -- Draft site with a hero headline of 'V1'.
  insert into public.gym_websites (gym_id, theme, design)
  values (
    v_gym, 'forged',
    '{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"p","slug":"","title":"Home","blocks":[{"id":"b","type":"hero","headline":"V1","imageUrl":""}]}]}'::jsonb
  );

  -- A row for the off gym, created WHILE entitled, then the gym is disabled
  -- so the UPDATE/DELETE policy checks below have a row to (fail to) touch.
  insert into public.gym_websites (gym_id, theme, design)
  values (v_off, 'forged', '{"version":2,"settings":{"themeId":"forged"},"pages":[]}'::jsonb);
  update public.gyms set website_builder_enabled = false where id = v_off;

  perform set_config('test.gym',       v_gym::text,       true);
  perform set_config('test.off',       v_off::text,       true);
  perform set_config('test.owner',     v_owner::text,     true);
  perform set_config('test.admin',     v_admin::text,     true);
  perform set_config('test.coach',     v_coach::text,     true);
  perform set_config('test.off_owner', v_off_owner::text, true);
end $$;

-- 1. Draft is not public.
select is(
  (select count(*)::int from public.gym_website_by_slug('pub-gym')),
  0, 'an unpublished draft is not surfaced by gym_website_by_slug');

-- 2. Admin publishes.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select ok(
  public.publish_gym_website(current_setting('test.gym')::uuid) is not null,
  'an admin can publish the site (RPC returns the new updated_at)');

-- 3. Now public.
select is(
  (select count(*)::int from public.gym_website_by_slug('pub-gym')),
  1, 'a published site is surfaced by gym_website_by_slug');

-- 4. The published snapshot carries the V1 headline.
select is(
  (select design->'pages'->0->'blocks'->0->>'headline' from public.gym_website_by_slug('pub-gym')),
  'V1', 'the public snapshot reflects the design at publish time');

-- 5. Owner edits the draft to V2 — the public snapshot must NOT change.
do $$ begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.save_gym_website(
    current_setting('test.gym')::uuid,
    '{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"p","slug":"","title":"Home","blocks":[{"id":"b","type":"hero","headline":"V2","imageUrl":""}]}]}'::jsonb,
    'forged', null);
end $$;
select is(
  (select design->'pages'->0->'blocks'->0->>'headline' from public.gym_website_by_slug('pub-gym')),
  'V1', 'editing the draft after publish does not leak to the public snapshot');

-- 6. ...but the draft itself did change.
select is(
  (select design->'pages'->0->'blocks'->0->>'headline'
     from public.gym_websites where gym_id = current_setting('test.gym')::uuid),
  'V2', 'the draft design was updated to V2');

-- 7. Unpublish takes it offline.
do $$ begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.unpublish_gym_website(current_setting('test.gym')::uuid);
end $$;
select is(
  (select count(*)::int from public.gym_website_by_slug('pub-gym')),
  0, 'unpublishing removes the site from public view');

-- 8. A coach cannot publish.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_ok(
  format($$ select public.publish_gym_website(%L::uuid) $$, current_setting('test.gym')),
  null, null, 'a coach without can_manage_website cannot publish');

-- 9. UPDATE on a disabled gym affects no rows (with-check entitlement fix).
do $$
declare v_cnt int;
begin
  perform _test_act_as(current_setting('test.off_owner')::uuid);
  perform set_config('test.upd_cnt', '0', true);
end $$;
-- Was "affects no rows" while the policy filtered it out. 0220 revoked
-- the grant entirely — a bare UPDATE could publish without taking the
-- snapshot — so the statement no longer runs for anybody, entitled or
-- not. The entitlement is still enforced where it now matters, on the RPC.
select throws_ok(
  $$ update public.gym_websites set published = true
       where gym_id = current_setting('test.off')::uuid $$,
  '42501',
  null,
  'nobody UPDATEs gym_websites directly any more, entitled gym or not'
);

-- 10. DELETE on a disabled gym affects no rows (delete-policy entitlement fix).
do $$
declare v_cnt int;
begin
  perform _test_act_as(current_setting('test.off_owner')::uuid);
  with d as (
    delete from public.gym_websites
      where gym_id = current_setting('test.off')::uuid returning 1
  ) select count(*) into v_cnt from d;
  perform set_config('test.del_cnt', v_cnt::text, true);
end $$;
select is(current_setting('test.del_cnt')::int, 0,
  'delete on a gym with website_builder_enabled=false affects no rows');

select * from finish();
rollback;
