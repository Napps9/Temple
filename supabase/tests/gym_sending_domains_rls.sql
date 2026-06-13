-- gym_sending_domains is read-gated on can_manage_comms (owner + admin by
-- default), tenant-isolated, and has NO client write path — every write
-- happens in the sending-domain edge function under the service role, so a
-- direct client INSERT must be refused by RLS.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@sd.test');
  v_admin  uuid := _test_mk_user('admin@sd.test');
  v_coach  uuid := _test_mk_user('coach@sd.test');
  v_member uuid := _test_mk_user('member@sd.test');
  v_adminb uuid := _test_mk_user('adminb@sd.test');
  v_gyma   uuid := _test_mk_gym('SD Gym A', 'sd-gym-a');
  v_gymb   uuid := _test_mk_gym('SD Gym B', 'sd-gym-b');
begin
  perform _test_mk_membership(v_gyma, v_owner,  'owner');
  perform _test_mk_membership(v_gyma, v_admin,  'admin');
  perform _test_mk_membership(v_gyma, v_coach,  'coach');
  perform _test_mk_membership(v_gyma, v_member, 'member');
  perform _test_mk_membership(v_gymb, v_adminb, 'admin');

  -- Seed a domain row for gym A (bypasses RLS as the test superuser).
  insert into public.gym_sending_domains (gym_id, domain)
    values (v_gyma, 'mail.sd-gym-a.com');

  perform set_config('test.gyma',   v_gyma::text,   true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.adminb', v_adminb::text, true);
end;
$$;

-- A member cannot read it.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_sending_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'a member cannot read the sending domain'
);

-- A coach cannot either (can_manage_comms is admin-only by default).
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_sending_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'a coach cannot read the sending domain'
);

-- An admin can.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_sending_domains
    where gym_id = current_setting('test.gyma')::uuid),
  1,
  'an admin can read their gym''s sending domain'
);

-- An admin of another gym cannot.
do $$ begin perform _test_act_as(current_setting('test.adminb')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_sending_domains
    where gym_id = current_setting('test.gyma')::uuid),
  0,
  'an admin of another gym cannot read this gym''s sending domain'
);

-- No client write path: even an admin can't INSERT directly.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select throws_like(
  $$ insert into public.gym_sending_domains (gym_id, domain)
     values (current_setting('test.gyma')::uuid, 'sneaky.example.com') $$,
  '%row-level security%',
  'a client INSERT is refused — writes only happen in the edge function'
);

select * from finish();
rollback;
