-- The lead pipeline honours its own switch (0217, 0226).
--
-- The pair that matters is the coach: allowed by default, refused once the
-- owner turns the capability off — which is what the leads screen has
-- always claimed and the database never enforced. Nothing changes for a
-- gym that has overridden nothing, and the first two assertions are here
-- to prove that rather than assume it.
--
-- The left_at assertion is the quieter one. user_can_assign_plan never
-- checked it, so somebody who left kept write access to names, emails and
-- phone numbers of people who never joined the gym.
--
-- 0226 moved the whole pipeline onto its own key, can_work_leads,
-- defaulting to exactly who held can_assign_plan — so every assertion
-- below still describes the same people, and the switch being turned off
-- is now the switch that says what it does.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@leadcap.test');
  v_coach uuid := _test_mk_user('coach@leadcap.test');
  v_gone  uuid := _test_mk_user('gone@leadcap.test');
  v_mem   uuid := _test_mk_user('member@leadcap.test');
  v_gym   uuid := _test_mk_gym('Lead Gym', 'leadcap');
  v_lead  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_gone,  'coach');
  perform _test_mk_membership(v_gym, v_mem,   'member');

  -- Left the gym, membership row still there. user_can_assign_plan reads
  -- role and nothing else, so this person passed it.
  update public.gym_memberships set left_at = now()
    where gym_id = v_gym and profile_id = v_gone;

  insert into public.leads (gym_id, full_name, email, status)
    values (v_gym, 'Wanda Prospect', 'wanda@leadcap.test', 'cold')
    returning id into v_lead;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.mem',   v_mem::text,   true);
  perform set_config('test.lead',  v_lead::text,  true);
end;
$$;

-- ============================================================================
-- Nothing changes for a gym that has overridden nothing
-- ============================================================================

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ select public.record_lead(
       current_setting('test.gym')::uuid, 'Colin Caller', 'colin@leadcap.test') $$,
  'a coach still takes an enquiry, because the capability defaults to their role'
);

select lives_ok(
  $$ select public.set_lead_status(
       current_setting('test.lead')::uuid, 'contacted'::public.lead_status) $$,
  'and still moves one along the pipeline'
);

-- ============================================================================
-- An owner's override is now a permission and not a hidden button
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
  values (current_setting('test.gym')::uuid, 'coach', 'can_work_leads', false);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.record_lead(
       current_setting('test.gym')::uuid, 'Nope Nelson', 'nope@leadcap.test') $$,
  'Not authorised',
  'the same coach cannot take an enquiry once the owner turns the switch off'
);

select throws_ok(
  $$ select public.set_lead_status(
       current_setting('test.lead')::uuid, 'intro_booked'::public.lead_status) $$,
  'Not authorised',
  'nor move one along'
);

select throws_ok(
  $$ select public.set_lead_assignee(
       current_setting('test.lead')::uuid, current_setting('test.coach')::uuid) $$,
  'Not authorised',
  'nor hand one to somebody'
);

select throws_ok(
  $$ select public.nudge_lead(current_setting('test.lead')::uuid) $$,
  'Not authorised',
  'nor chase one'
);

select throws_ok(
  $$ select public.clear_lead_follow_up(current_setting('test.lead')::uuid) $$,
  'Not authorised',
  'nor clear the chase'
);

-- The owner is never overridable, which is why the switch is safe to have.
select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.set_lead_status(
       current_setting('test.lead')::uuid, 'intro_booked'::public.lead_status) $$,
  'while the owner carries on regardless — owner is not overridable'
);

-- ============================================================================
-- Leaving the gym takes the pipeline with it
-- ============================================================================

select _test_act_as(current_setting('test.gone')::uuid);

-- This coach's capability was never touched. What refuses them is
-- left_at, which the raw-role helper did not look at.
select throws_ok(
  $$ select public.record_lead(
       current_setting('test.gym')::uuid, 'Ghost Gary', 'gary@leadcap.test') $$,
  'Not authorised',
  'someone who has left the gym cannot reach its enquiries at all'
);

select finish();
rollback;
