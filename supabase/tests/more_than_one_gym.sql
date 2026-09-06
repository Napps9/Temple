-- 0283: one account can belong to more than one gym. Every door that
-- mints a membership lets an active member of another gym through, the
-- same-gym rejoin still reactivates the one row, my_gyms lists them all,
-- and a crash report lands under the gym whose screen broke.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_a     uuid := _test_mk_user('a@manygyms.test');
  v_b     uuid := _test_mk_user('b@manygyms.test');
  v_owner uuid := _test_mk_user('owner@manygyms.test');
  v_coach uuid := _test_mk_user('coach@manygyms.test');
  v_open  uuid := _test_mk_gym('Open Gym', 'open-gym');
  v_inv   uuid := _test_mk_gym('Invite Gym', 'invite-gym');
  v_trial uuid := _test_mk_gym('Trial Gym', 'trial-gym');
  v_ct    uuid;
  v_sess  uuid;
begin
  perform _test_mk_membership(v_inv,   v_owner, 'owner');
  perform _test_mk_membership(v_trial, v_owner, 'owner');
  perform _test_mk_membership(v_trial, v_coach, 'coach');
  insert into public.invite_codes (gym_id, code, role, created_by)
    values (v_inv, 'SECONDGYM', 'coach', v_owner);
  insert into public.class_types (gym_id, name, color)
    values (v_trial, 'Foundations', '#2563EB') returning id into v_ct;
  v_sess := _test_mk_session(v_trial, v_coach, now() + interval '2 days', 60, v_ct);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.open',  v_open::text,  true);
  perform set_config('test.inv',   v_inv::text,   true);
  perform set_config('test.trial', v_trial::text, true);
  perform set_config('test.sess',  v_sess::text,  true);
end;
$$;

-- A founds a gym, then joins another, is invited into a third and takes
-- a trial at a fourth: four active memberships, one account.
do $$
declare
  v_gym uuid;
begin
  perform _test_act_as(current_setting('test.a')::uuid);
  v_gym := public.create_gym('First Gym', 'first-gym');
  perform set_config('test.first', v_gym::text, true);
end;
$$;

select lives_ok(
  $$ select public.join_gym_by_slug('open-gym') $$,
  'an owner elsewhere joins a gym by slug'
);

select lives_ok(
  $$ select public.create_gym('Second Gym', 'second-gym') $$,
  'and founds a second gym of their own'
);

select lives_ok(
  $$ select * from public.accept_invite('SECONDGYM') $$,
  'and accepts an invite into a third'
);

select _test_act_as(current_setting('test.coach')::uuid);
select lives_ok(
  $$ select public.create_trial_pass(
       current_setting('test.trial')::uuid, null,
       current_setting('test.sess')::uuid) $$,
  'a coach mints a trial link at a fourth'
);

do $$
declare v_token text;
begin
  select token into v_token from public.trial_passes
   where session_id = current_setting('test.sess')::uuid
   order by created_at desc limit 1;
  perform set_config('test.token', v_token, true);
end $$;

select _test_act_as(current_setting('test.a')::uuid);
select lives_ok(
  format($$ select public.redeem_trial_pass(%L,
            current_setting('test.sess')::uuid) $$,
         current_setting('test.token')),
  'and the account elsewhere redeems it'
);

select is(
  (select count(*)::int from public.gym_memberships
    where profile_id = current_setting('test.a')::uuid and left_at is null),
  5,
  'five active memberships on one account'
);

select is(
  (select count(*)::int from public.my_gyms() where left_at is null),
  5,
  'and my_gyms lists every one of them'
);

-- The same-gym path is unchanged: leave, rejoin, still one row.
do $$
begin
  perform _test_act_as(current_setting('test.b')::uuid);
  perform public.join_gym_by_slug('open-gym');
  perform public.leave_gym(current_setting('test.open')::uuid,
                           current_setting('test.b')::uuid);
  perform public.join_gym_by_slug('open-gym');
end;
$$;

select is(
  (select count(*)::int from public.gym_memberships
    where profile_id = current_setting('test.b')::uuid and left_at is null),
  1,
  'leaving then rejoining the same gym reactivates the one membership'
);

-- A crash report names the gym whose screen broke.
select _test_act_as(current_setting('test.a')::uuid);
select public.report_client_error('/book', 'broke at Open Gym', null, null,
  'web', null, current_setting('test.open')::uuid);
select public.report_client_error('/book', 'broke somewhere I am not', null, null,
  'web', null, '00000000-0000-0000-0000-000000000000'::uuid);

reset role;
select is(
  (select gym_id from public.client_errors
    where message = 'broke at Open Gym'),
  current_setting('test.open')::uuid,
  'a crash report lands under the gym the app was showing'
);

select is(
  (select gym_id from public.client_errors
    where message = 'broke somewhere I am not'),
  current_setting('test.first')::uuid,
  'and a gym the caller is not in falls back to their oldest'
);

select * from finish();
rollback;
