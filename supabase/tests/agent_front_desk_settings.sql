-- AI front desk settings (0136): owner-only setters, staff-visible RLS,
-- and no client write path to the platform-provisioned columns.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner_a uuid := _test_mk_user('owner-a@agent.test');
  v_coach_a uuid := _test_mk_user('coach-a@agent.test');
  v_member_a uuid := _test_mk_user('member-a@agent.test');
  v_owner_b uuid := _test_mk_user('owner-b@agent.test');
  v_gym_a   uuid := _test_mk_gym('Agent Gym A', 'agent-a');
  v_gym_b   uuid := _test_mk_gym('Agent Gym B', 'agent-b');
begin
  perform _test_mk_membership(v_gym_a, v_owner_a, 'owner');
  perform _test_mk_membership(v_gym_a, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym_a, v_member_a, 'member');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');
  perform set_config('test.gym_a',   v_gym_a::text,   true);
  perform set_config('test.gym_b',   v_gym_b::text,   true);
  perform set_config('test.owner_a', v_owner_a::text, true);
  perform set_config('test.coach_a', v_coach_a::text, true);
  perform set_config('test.member_a', v_member_a::text, true);
  perform set_config('test.owner_b', v_owner_b::text, true);
end $$;

-- 1. A coach cannot flip the switch.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;
select throws_like(
  $$ select set_gym_agent_enabled(current_setting('test.gym_a')::uuid, true) $$,
  '%owner%',
  'a coach cannot enable the AI front desk'
);

-- 2. The owner can, and the row upserts.
do $$ begin perform _test_act_as(current_setting('test.owner_a')::uuid); end $$;
do $$ begin
  perform set_gym_agent_enabled(current_setting('test.gym_a')::uuid, true);
end $$;
reset role;
select is(
  (select enabled from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  true,
  'owner toggle upserts the settings row'
);

-- 3. Context is capped.
do $$ begin perform _test_act_as(current_setting('test.owner_a')::uuid); end $$;
select throws_like(
  $$ select set_gym_agent_context(current_setting('test.gym_a')::uuid, repeat('x', 4001)) $$,
  '%4000%',
  'agent notes above 4000 characters are rejected'
);

-- 4. Context saves and trims.
do $$ begin
  perform set_gym_agent_context(current_setting('test.gym_a')::uuid, '  Free parking on site  ');
end $$;
reset role;
select is(
  (select context from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  'Free parking on site',
  'owner-written context persists trimmed'
);

-- 5. Staff of the gym can read the settings row.
do $$ begin perform _test_act_as(current_setting('test.coach_a')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  1,
  'gym staff can read their agent settings'
);

-- 6. Staff of another gym cannot.
do $$ begin perform _test_act_as(current_setting('test.owner_b')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  0,
  'another gym''s owner sees nothing'
);

-- 7. A member cannot.
do $$ begin perform _test_act_as(current_setting('test.member_a')::uuid); end $$;
select is(
  (select count(*)::int from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  0,
  'a member sees nothing'
);

-- 8. There is no client write path: an owner's direct UPDATE of the
-- platform-provisioned number silently matches zero rows.
do $$ begin perform _test_act_as(current_setting('test.owner_a')::uuid); end $$;
do $$ begin
  update public.gym_agent_settings
    set phone_number = '+15005550006'
    where gym_id = current_setting('test.gym_a')::uuid;
end $$;
reset role;
select is(
  (select phone_number from public.gym_agent_settings
   where gym_id = current_setting('test.gym_a')::uuid),
  null,
  'clients cannot write phone_number directly'
);

select * from finish();
rollback;
