-- Retention cockpit (0117/0118): a past_due membership is an at-risk but
-- still-active relationship, so v_member_cohort reports is_active = true and
-- is_expired = false — a failing renewal must not read as a departure. The
-- contrast case (a lapsed sub) confirms is_expired still fires for a genuine
-- lapse, so past_due isn't just collapsing every non-active state to active.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@pastdue.test');
  v_m_pd     uuid := _test_mk_user('pastdue@pastdue.test');
  v_m_lapsed uuid := _test_mk_user('lapsed@pastdue.test');
  v_gym      uuid := _test_mk_gym('Past Due Gym', 'past-due-gym');
  v_plan     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,    'owner');
  perform _test_mk_membership(v_gym, v_m_pd,     'member');
  perform _test_mk_membership(v_gym, v_m_lapsed, 'member');

  insert into public.membership_plans (gym_id, name, kind)
  values (v_gym, 'Unlimited', 'unlimited')
  returning plan_id into v_plan;

  -- The past_due member: their renewal charge failed. paid_period_end is in
  -- the past (the period they paid for has ended), yet they haven't left.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_pd, v_gym, v_plan, 'past_due'::public.plan_sub_state,
         now() - interval '2 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_pd;

  -- The lapsed member: a genuine departure — never recovered.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_lapsed, v_gym, v_plan, 'lapsed'::public.plan_sub_state,
         now() - interval '20 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_lapsed;

  -- Read as the owner for full RLS visibility (v_member_cohort is invoker).
  perform _test_act_as(v_owner);

  perform set_config('test.gym',      v_gym::text,      true);
  perform set_config('test.m_pd',     v_m_pd::text,     true);
  perform set_config('test.m_lapsed', v_m_lapsed::text, true);
end $$;

-- 1. past_due counts as an active relationship.
select is(
  (select is_active from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_pd')::uuid),
  true,
  'a past_due membership is an active relationship');

-- 2. past_due is NOT expired (the key miscount this prevents).
select is(
  (select is_expired from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_pd')::uuid),
  false,
  'a past_due membership is not classified as expired');

-- 3-4. A genuinely lapsed sub still reads expired + not active.
select is(
  (select is_active from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_lapsed')::uuid),
  false,
  'a lapsed membership is not an active relationship');
select is(
  (select is_expired from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_lapsed')::uuid),
  true,
  'a lapsed membership is classified as expired');

select * from finish();
rollback;
