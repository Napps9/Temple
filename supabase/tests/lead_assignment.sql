-- Lead assignment (0108): round-robin spreads across active coaches,
-- inactive coaches are skipped, single_default and manual behave, an
-- ownerless-of-coaches gym falls back to the owner, and assign_lead is
-- idempotent (re-running never double-notifies).

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  -- Round-robin gym: two active coaches, one who has left, an owner.
  v_rr_owner uuid := _test_mk_user('rr-owner@assign.test');
  v_c1 uuid := _test_mk_user('c1@assign.test');
  v_c2 uuid := _test_mk_user('c2@assign.test');
  v_c3 uuid := _test_mk_user('c3-left@assign.test');
  v_rr uuid := _test_mk_gym('RR Gym', 'rr-gym');
  -- single_default gym.
  v_sd_owner uuid := _test_mk_user('sd-owner@assign.test');
  v_sd_coach uuid := _test_mk_user('sd-coach@assign.test');
  v_sd uuid := _test_mk_gym('SD Gym', 'sd-gym');
  -- manual gym.
  v_m_owner uuid := _test_mk_user('m-owner@assign.test');
  v_m_coach uuid := _test_mk_user('m-coach@assign.test');
  v_m uuid := _test_mk_gym('Manual Gym', 'manual-gym');
  -- ownerless-of-coaches gym.
  v_nc_owner uuid := _test_mk_user('nc-owner@assign.test');
  v_nc uuid := _test_mk_gym('No Coach Gym', 'nocoach-gym');
begin
  perform _test_mk_membership(v_rr, v_rr_owner, 'owner');
  perform _test_mk_membership(v_rr, v_c1, 'coach');
  perform _test_mk_membership(v_rr, v_c2, 'coach');
  perform _test_mk_membership(v_rr, v_c3, 'coach');
  -- c3 has left the gym.
  update public.gym_memberships set left_at = now()
    where gym_id = v_rr and profile_id = v_c3;

  perform _test_mk_membership(v_sd, v_sd_owner, 'owner');
  perform _test_mk_membership(v_sd, v_sd_coach, 'coach');
  insert into public.lead_assignment_rules (gym_id, strategy, default_coach_id)
    values (v_sd, 'single_default', v_sd_coach);

  perform _test_mk_membership(v_m, v_m_owner, 'owner');
  perform _test_mk_membership(v_m, v_m_coach, 'coach');
  insert into public.lead_assignment_rules (gym_id, strategy)
    values (v_m, 'manual');

  perform _test_mk_membership(v_nc, v_nc_owner, 'owner');

  perform set_config('test.rr', v_rr::text, true);
  perform set_config('test.rr_owner', v_rr_owner::text, true);
  perform set_config('test.c3', v_c3::text, true);
  perform set_config('test.sd', v_sd::text, true);
  perform set_config('test.sd_owner', v_sd_owner::text, true);
  perform set_config('test.sd_coach', v_sd_coach::text, true);
  perform set_config('test.m', v_m::text, true);
  perform set_config('test.m_owner', v_m_owner::text, true);
  perform set_config('test.nc', v_nc::text, true);
  perform set_config('test.nc_owner', v_nc_owner::text, true);
end $$;

-- Four round-robin captures as the owner.
do $$
declare i int;
begin
  perform _test_act_as(current_setting('test.rr_owner')::uuid);
  for i in 1..4 loop
    perform record_lead(current_setting('test.rr')::uuid, 'RR Lead ' || i);
  end loop;
end $$;

-- 1. Every lead was assigned to somebody.
select is(
  (select count(*)::int from public.leads
     where gym_id = current_setting('test.rr')::uuid and assigned_coach_id is null),
  0,
  'round-robin leaves no lead unassigned');

-- 2. The coach who left receives none.
select is(
  (select count(*)::int from public.leads
     where gym_id = current_setting('test.rr')::uuid
       and assigned_coach_id = current_setting('test.c3')::uuid),
  0,
  'a coach who has left the gym is skipped');

-- 3. The four leads split evenly across the two active coaches.
select is(
  (select array_to_string(array_agg(c order by c), ',')
     from (select count(*) c from public.leads
             where gym_id = current_setting('test.rr')::uuid
               and assigned_coach_id is not null
             group by assigned_coach_id) t),
  '2,2',
  'round-robin distributes evenly across active coaches');

-- 4. assign_lead is idempotent: one in-app notification per assigned lead.
select is(
  (select max(cnt)::int from (
     select count(*) cnt from public.lead_notifications
       where gym_id = current_setting('test.rr')::uuid and channel = 'in_app'
       group by lead_id) t),
  1,
  'each lead has exactly one in-app notification (enqueue is idempotent)');

-- 5. Re-running assign_lead on an already-assigned lead adds no duplicate.
do $$
declare v_lead uuid;
begin
  select id into v_lead from public.leads
    where gym_id = current_setting('test.rr')::uuid limit 1;
  perform assign_lead(v_lead);
  perform assign_lead(v_lead);
  perform set_config('test.rr_lead', v_lead::text, true);
end $$;
select is(
  (select count(*)::int from public.lead_notifications
     where lead_id = current_setting('test.rr_lead')::uuid and channel = 'in_app'),
  1,
  're-running assign_lead never double-fires the in-app notification');

-- 6. single_default routes to the configured coach.
do $$
begin
  perform _test_act_as(current_setting('test.sd_owner')::uuid);
  perform record_lead(current_setting('test.sd')::uuid, 'SD Lead');
end $$;
select is(
  (select assigned_coach_id::text from public.leads
     where gym_id = current_setting('test.sd')::uuid limit 1),
  current_setting('test.sd_coach'),
  'single_default assigns to the configured default coach');

-- 7. manual leaves the lead unassigned.
do $$
begin
  perform _test_act_as(current_setting('test.m_owner')::uuid);
  perform record_lead(current_setting('test.m')::uuid, 'Manual Lead');
end $$;
select is(
  (select assigned_coach_id from public.leads
     where gym_id = current_setting('test.m')::uuid limit 1),
  null,
  'manual strategy leaves the lead unassigned');

-- 8. No in-app notification for a manual (unassigned) lead.
select is(
  (select count(*)::int from public.lead_notifications
     where gym_id = current_setting('test.m')::uuid),
  0,
  'manual strategy enqueues no notification');

-- 9. No active coach: falls back to the owner so the lead still lands.
do $$
begin
  perform _test_act_as(current_setting('test.nc_owner')::uuid);
  perform record_lead(current_setting('test.nc')::uuid, 'NC Lead');
end $$;
select is(
  (select assigned_coach_id::text from public.leads
     where gym_id = current_setting('test.nc')::uuid limit 1),
  current_setting('test.nc_owner'),
  'with no active coach the lead falls back to the owner');

select * from finish();
rollback;
