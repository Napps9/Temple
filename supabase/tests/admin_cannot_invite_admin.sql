-- Invariant: admins cannot mint admins or owners via create_invite.
--
-- Owners retain sole control of who's an admin. The capability matrix
-- grants can_invite to admins, but create_invite enforces the
-- sub-rule: if the caller is not the owner, p_role must be in
-- ('coach', 'staff', 'member').

begin;
select plan(3);

\i tests/_helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@invite.test');
  v_admin uuid := _test_mk_user('admin@invite.test');
  v_gym   uuid := _test_mk_gym('Invite Gym', 'invite');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');

  perform set_config('test.gym', v_gym::text, true);

  -- Act as admin for the first two throws_ok calls.
  perform _test_act_as(v_admin);
end;
$$;

select throws_ok(
  format($q$select create_invite(%L::uuid, 'admin'::public.gym_role, null)$q$,
         current_setting('test.gym')),
  null::text, null::text,
  'admin cannot mint admins'
);

select throws_ok(
  format($q$select create_invite(%L::uuid, 'owner'::public.gym_role, null)$q$,
         current_setting('test.gym')),
  null::text, null::text,
  'admin cannot mint owners'
);

-- Switch to owner; minting an admin must succeed.
do $$
declare
  v_owner uuid;
begin
  select id into v_owner from auth.users where email = 'owner@invite.test';
  perform _test_act_as(v_owner);
  perform create_invite(current_setting('test.gym')::uuid, 'admin'::public.gym_role, null);
end;
$$;

select is(
  (select count(*) from public.invite_codes
   where gym_id = current_setting('test.gym')::uuid
     and role = 'admin'),
  1::bigint,
  'owner can mint an admin'
);

select * from finish();
rollback;
