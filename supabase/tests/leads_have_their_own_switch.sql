-- The pipeline's own switch, and the tables that came with it (0226)
--
-- The split has to be invisible on day one: the same people can do the
-- same things, because can_work_leads defaults to exactly who held
-- can_assign_plan. What must NOT be invisible is the second half — the
-- nine policies moved off user_can_assign_plan, a raw-role helper with no
-- left_at guard and no override lookup, so a coach whose switch an owner
-- turned off could still read the whole pipeline and somebody who left in
-- March could read it in July.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@leadsplit.test');
  v_coach uuid := _test_mk_user('coach@leadsplit.test');
  v_gone  uuid := _test_mk_user('gone@leadsplit.test');
  v_gym   uuid := _test_mk_gym('Split Gym', 'leadsplit');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_gone,  'coach');
  update public.gym_memberships set left_at = now() - interval '4 months'
    where gym_id = v_gym and profile_id = v_gone;

  insert into public.leads (gym_id, full_name, email, status)
  values (v_gym, 'Priya Nair', 'priya@leadsplit.test', 'cold');

  insert into public.gym_agent_settings (gym_id) values (v_gym)
    on conflict do nothing;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- Day one: nothing changed
-- ---------------------------------------------------------------------------

select is(
  public.default_capability('coach', 'can_work_leads'),
  public.default_capability('coach', 'can_assign_plan'),
  'a coach holds the new key exactly where they held the old one'
);

select is(
  public.default_capability('staff', 'can_work_leads'),
  true,
  'and so does the front desk, which is the role it exists for'
);

select is(
  public.default_capability('member', 'can_work_leads'),
  false,
  'a member never does'
);

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.leads
     where gym_id = current_setting('test.gym')::uuid),
  1,
  'and the coach still reads the pipeline'
);

-- ---------------------------------------------------------------------------
-- The switch now reaches the reads, not just the writes
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
values (current_setting('test.gym')::uuid, 'coach', 'can_work_leads', false);

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.leads
     where gym_id = current_setting('test.gym')::uuid),
  0,
  'turned off, the coach cannot even see the enquiries — the old policies read a raw role and ignored this'
);

select is(
  (select count(*)::int from public.gym_agent_settings
     where gym_id = current_setting('test.gym')::uuid),
  0,
  'nor the front desk settings'
);

-- ---------------------------------------------------------------------------
-- Somebody who left
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.gone')::uuid);

select is(
  (select count(*)::int from public.leads
     where gym_id = current_setting('test.gym')::uuid),
  0,
  'somebody who left four months ago reads nothing'
);

-- ---------------------------------------------------------------------------
-- Membership machinery keeps the key it should always have had
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select ok(
  public.effective_can(current_setting('test.gym')::uuid, 'can_assign_plan'),
  'the coach still assigns plans — turning the lead switch off did not take that'
);

select ok(
  not public.effective_can(current_setting('test.gym')::uuid, 'can_work_leads'),
  'which is the whole point of splitting them'
);

select * from finish();
rollback;
