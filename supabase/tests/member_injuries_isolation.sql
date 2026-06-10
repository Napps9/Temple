-- Injury rows are health data: members see only their own; coaches
-- read via can_see_health_flag (default-on) and are locked out when
-- the override is flipped off. The log_injury RPC raises a staff
-- alert, and log_injury_update appends a check-in + rolls the parent
-- row's pain/status forward.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@inj.test');
  v_coach uuid := _test_mk_user('coach@inj.test');
  v_a     uuid := _test_mk_user('a@inj.test');
  v_b     uuid := _test_mk_user('b@inj.test');
  v_gym   uuid := _test_mk_gym('Injury Gym', 'injury-gym');
  v_inj   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');

  -- Member B logs an injury through the RPC.
  perform _test_act_as(v_b);
  v_inj := public.log_injury(
    v_gym, 'knee', 'left', 'Tweaked on box jumps', 6,
    array['back_squat'], array['bench_press'], current_date - 3);
  execute 'reset role';

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.inj',   v_inj::text,   true);
end;
$$;

-- Member A cannot see member B's injury.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.member_injuries)::int,
  0,
  'member A cannot SELECT member B''s injuries'
);

-- Coach sees it (can_see_health_flag default-on for coach).
do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.member_injuries
    where profile_id = current_setting('test.b')::uuid)::int,
  1,
  'coach can SELECT member injuries via can_see_health_flag'
);

-- The RPC raised an injury_new staff alert visible to the coach.
select is(
  (select count(*) from public.staff_alerts
    where kind = 'injury_new'
      and related_id = current_setting('test.inj')::uuid)::int,
  1,
  'log_injury raises an injury_new staff alert'
);

-- Member B appends a weekly check-in.
do $$
begin
  perform _test_act_as(current_setting('test.b')::uuid);
  perform public.log_injury_update(
    current_setting('test.inj')::uuid, 3, 'better', 'improving', 'Less sore');
end;
$$;

select is(
  (select pain_level from public.member_injuries
    where id = current_setting('test.inj')::uuid),
  3,
  'log_injury_update rolls pain_level onto the parent row'
);

select is(
  (select status from public.member_injuries
    where id = current_setting('test.inj')::uuid),
  'improving',
  'log_injury_update rolls status onto the parent row'
);

-- ...and the coach gets an injury_update alert.
do $$
begin
  execute 'reset role';
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.staff_alerts
    where kind = 'injury_update'
      and related_id = current_setting('test.inj')::uuid)::int,
  1,
  'log_injury_update raises an injury_update staff alert'
);

-- Owner flips can_see_health_flag off for coaches; coach is locked out.
do $$
begin
  execute 'reset role';
  perform _test_act_as(current_setting('test.owner')::uuid);
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (current_setting('test.gym')::uuid, 'coach', 'can_see_health_flag', false);
  execute 'reset role';
  perform _test_act_as(current_setting('test.coach')::uuid);
end;
$$;

select is(
  (select count(*) from public.member_injuries
    where profile_id = current_setting('test.b')::uuid)::int,
  0,
  'coach loses injury visibility when can_see_health_flag is flipped off'
);

select * from finish();
rollback;
