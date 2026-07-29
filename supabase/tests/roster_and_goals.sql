-- The rope dial (set_agent_job_level) is owner-only and both-directions;
-- gym_goals follows the old targets' audience: owner writes, admin reads,
-- coaches and members see nothing.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@roster.test');
  v_coach  uuid := _test_mk_user('coach@roster.test');
  v_gym    uuid := _test_mk_gym('Roster Gym', 'roster-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.agent_authority (gym_id, action_kind, level)
  values (v_gym, 'chase_message', 'autonomous');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
end $$;

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select set_agent_job_level(current_setting('test.gym')::uuid,
       'chase_message', 'approval') $$,
  'Only the owner can change this',
  'coach cannot move the rope'
);

select throws_ok(
  $$ insert into public.gym_goals (gym_id, target_value, due_on, created_by)
     values (current_setting('test.gym')::uuid, 200, '2027-12-31',
             current_setting('test.coach')::uuid) $$,
  42501,
  null,
  'coach cannot set a goal'
);

select is(
  (select count(*)::int from public.gym_goals),
  0,
  'coach reads no goals'
);

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select set_agent_job_level(current_setting('test.gym')::uuid,
       'chase_message', 'approval') $$,
  'owner pulls the job back to asks-first'
);

select is(
  (select level from public.agent_authority
    where gym_id = current_setting('test.gym')::uuid),
  'approval',
  'the dial moved'
);

select throws_ok(
  $$ select set_agent_job_level(current_setting('test.gym')::uuid,
       'plan_adjustment_offer', 'autonomous') $$,
  'That job is not switched on',
  'no authority row, no dial'
);

select lives_ok(
  $$ insert into public.gym_goals (gym_id, target_value, due_on, created_by)
     values (current_setting('test.gym')::uuid, 200, '2027-12-31',
             current_setting('test.owner')::uuid) $$,
  'owner sets a goal'
);

select * from finish();
rollback;
