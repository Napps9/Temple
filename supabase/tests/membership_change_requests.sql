-- Membership change policies: gyms get the right defaults, only an owner
-- can change them, and the requests table + one-pending guard exist.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@mcr.test');
  v_member uuid := _test_mk_user('member@mcr.test');
  v_gym    uuid := _test_mk_gym('MCR Gym', 'mcr-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
end $$;

-- 1-3. Defaults: upgrade self-serve, downgrade + cancel request-based.
select is(
  (select membership_upgrade_policy::text from public.gyms
   where id = current_setting('test.gym')::uuid),
  'self_serve', 'upgrade defaults to self_serve');
select is(
  (select membership_downgrade_policy::text from public.gyms
   where id = current_setting('test.gym')::uuid),
  'request', 'downgrade defaults to request');
select is(
  (select membership_cancel_policy::text from public.gyms
   where id = current_setting('test.gym')::uuid),
  'request', 'cancel defaults to request');

-- 4. An owner can change them.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.set_membership_change_policies(
    current_setting('test.gym')::uuid, 'request', 'request', 'self_serve');
end $$;
select is(
  (select membership_cancel_policy::text from public.gyms
   where id = current_setting('test.gym')::uuid),
  'self_serve', 'owner can set the cancel policy');

-- 5. A member cannot.
do $$
begin
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;
select throws_ok(
  $q$ select public.set_membership_change_policies(
        current_setting('test.gym')::uuid,
        'self_serve', 'self_serve', 'self_serve') $q$,
  null::text,
  'Only an owner can change membership policies',
  'a member cannot change membership policies');

-- 6-8. Structure.
select has_table('public'::name, 'membership_change_requests'::name,
  'membership_change_requests table exists');
select has_index('public'::name, 'membership_change_requests'::name,
  'membership_change_requests_one_pending'::name,
  'one-pending guard index exists');
select col_is_null('public'::name, 'membership_change_requests'::name,
  'target_plan_id'::name, 'target_plan_id is nullable (cancel carries none)');

select * from finish();
rollback;
