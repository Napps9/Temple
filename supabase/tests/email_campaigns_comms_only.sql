-- email_campaigns are gated on can_manage_comms (owner + admin by
-- default) and tenant-isolated: a member can't create one, can't read
-- one, and an admin of another gym can't read this gym's campaigns.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@cc.test');
  v_admin  uuid := _test_mk_user('admin@cc.test');
  v_member uuid := _test_mk_user('member@cc.test');
  v_adminb uuid := _test_mk_user('adminb@cc.test');
  v_gyma   uuid := _test_mk_gym('Comms Gym A', 'comms-gym-a');
  v_gymb   uuid := _test_mk_gym('Comms Gym B', 'comms-gym-b');
begin
  perform _test_mk_membership(v_gyma, v_owner,  'owner');
  perform _test_mk_membership(v_gyma, v_admin,  'admin');
  perform _test_mk_membership(v_gyma, v_member, 'member');
  perform _test_mk_membership(v_gymb, v_adminb, 'admin');
  perform set_config('test.gyma',   v_gyma::text,   true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.adminb', v_adminb::text, true);
  perform set_config('test.cid',    gen_random_uuid()::text, true);
end;
$$;

-- A member cannot create a campaign.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select throws_like(
  $$ insert into public.email_campaigns (gym_id, created_by, title)
     values (current_setting('test.gyma')::uuid,
             current_setting('test.member')::uuid, 'Nope') $$,
  '%row-level security%',
  'member cannot insert a campaign'
);

-- An admin can.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select lives_ok(
  $$ insert into public.email_campaigns (id, gym_id, created_by, title)
     values (current_setting('test.cid')::uuid,
             current_setting('test.gyma')::uuid,
             current_setting('test.admin')::uuid, 'Admin campaign') $$,
  'admin can insert a campaign'
);

select is(
  (select count(*) from public.email_campaigns
    where id = current_setting('test.cid')::uuid)::int,
  1,
  'admin sees their gym''s campaign'
);

-- The member still can't read it.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select is(
  (select count(*) from public.email_campaigns
    where id = current_setting('test.cid')::uuid)::int,
  0,
  'member cannot SELECT a campaign'
);

-- An admin of a different gym can't read it either.
do $$ begin perform _test_act_as(current_setting('test.adminb')::uuid); end $$;
select is(
  (select count(*) from public.email_campaigns
    where id = current_setting('test.cid')::uuid)::int,
  0,
  'admin of another gym cannot SELECT this gym''s campaign'
);

select * from finish();
rollback;
