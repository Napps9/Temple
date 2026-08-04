-- payment_chase_preview (0249, tightened in 0250): the story page shows
-- the draft before the yes. Same substitution as _agent_execute_action's
-- chase branch, read-only — what the owner reads is what would be sent,
-- including the executor-only placeholders and, when the tick already
-- proposed a chase, the proposal's payload rather than live lookups. A
-- gym without a chase_message template never took the job on, so there
-- is no draft and the function returns zero rows rather than raising.
--
-- All fixtures (including the proposed action) are inserted in the
-- superuser phase before the first _test_act_as — RESET ROLE does not
-- reliably undo _test_act_as (see CLAUDE.md).

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@preview.test');
  v_member   uuid := _test_mk_user('member@preview.test');
  v_renamed  uuid := _test_mk_user('renamed@preview.test');
  v_gym      uuid := _test_mk_gym('Preview Gym', 'preview-gym');
  v_gymoff   uuid := _test_mk_gym('Job Off Gym', 'preview-job-off-gym');
  v_owneroff uuid := _test_mk_user('owneroff@preview.test');
  v_moff     uuid := _test_mk_user('moff@preview.test');
  v_plan     uuid;
  v_planoff  uuid;
  v_ms uuid; v_msren uuid; v_msoff uuid;
  v_sub uuid; v_subren uuid; v_suboff uuid;
  v_case uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_ms := _test_mk_membership(v_gym, v_member, 'member');
  v_msren := _test_mk_membership(v_gym, v_renamed, 'member');
  perform _test_mk_membership(v_gymoff, v_owneroff, 'owner');
  v_msoff := _test_mk_membership(v_gymoff, v_moff, 'member');

  update public.profiles set full_name = 'Maya Rivers' where id = v_member;
  update public.profiles set full_name = 'New Name' where id = v_renamed;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 7500) returning plan_id into v_plan;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gymoff, 'Unlimited', 'unlimited', 7500) returning plan_id into v_planoff;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms, v_member, v_gym, v_plan, 'active', 7500) returning id into v_sub;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_msren, v_renamed, v_gym, v_plan, 'active', 7500)
  returning id into v_subren;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_msoff, v_moff, v_gymoff, v_planoff, 'active', 7500)
  returning id into v_suboff;

  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  values
    (v_sub, v_member, v_gym, now() - interval '2 days', 1, now() + interval '3 days'),
    (v_subren, v_renamed, v_gym, now() - interval '4 days', 2, now() + interval '2 days'),
    (v_suboff, v_moff, v_gymoff, now() - interval '2 days', 1, now() + interval '3 days');

  -- The template an owner edited to lean on the executor-only
  -- placeholders — the executor fills {offer_plan}; 0250 makes the
  -- preview fill it too.
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'chase_message', 'Hi {first_name} — {gym_name}. Your {plan_name} payment needs a look, or {offer_plan} might suit.');

  -- The tick already proposed a chase for the renamed member's case,
  -- with the name as it was at tick time. request_payment_chase would
  -- approve and execute exactly this action, so the preview must render
  -- from its payload, not from the profile as it reads today.
  insert into public.agent_cases (gym_id, plan_subscription_id, profile_id)
  values (v_gym, v_subren, v_renamed) returning id into v_case;
  insert into public.agent_actions
    (gym_id, teammate, action_kind, subject_profile, subject_subscription,
     case_id, payload, status)
  values
    (v_gym, 'revenue', 'chase_message', v_renamed, v_subren, v_case,
     jsonb_build_object('member_name', 'Old Name', 'plan_name', 'Unlimited'),
     'proposed');

  perform set_config('test.gym',      v_gym::text,      true);
  perform set_config('test.gymoff',   v_gymoff::text,   true);
  perform set_config('test.owner',    v_owner::text,    true);
  perform set_config('test.owneroff', v_owneroff::text, true);
  perform set_config('test.member',   v_member::text,   true);
  perform set_config('test.sub',      v_sub::text,      true);
  perform set_config('test.subren',   v_subren::text,   true);
  perform set_config('test.suboff',   v_suboff::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- Owner: the draft reads exactly as the executor would send it.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid)),
  1,
  'owner gets one draft row'
);

select ok(
  (select p.body not like '%{%' from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'no placeholder is left unfilled'
);

select ok(
  (select p.body like '%Maya%' from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'the draft greets the member by first name'
);

select ok(
  (select p.body like '%Preview Gym%' from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'the draft names the gym'
);

select ok(
  (select p.body like '%Unlimited%' from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'the draft names the plan'
);

select is(
  (select p.subject from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'About your Preview Gym membership payment',
  'the subject matches the executor''s chase subject'
);

-- {offer_plan} is executor vocabulary the preview used to skip: it must
-- fill with the executor's exact fallback, not survive as braces.
select ok(
  (select p.body like '%a smaller plan%' from payment_chase_preview(
     current_setting('test.gym')::uuid,
     current_setting('test.sub')::uuid) p),
  'an executor-only placeholder previews with the executor''s fallback'
);

-- ---------------------------------------------------------------------------
-- A pending proposal: request_payment_chase would send THAT action, so
-- the preview renders its payload — the name at tick time — not the
-- profile as renamed since.
-- ---------------------------------------------------------------------------
select ok(
  (select p.body like '%Old%' and p.body not like '%New%'
     from payment_chase_preview(
       current_setting('test.gym')::uuid,
       current_setting('test.subren')::uuid) p),
  'a pending chase previews from its payload, not the live profile'
);

-- ---------------------------------------------------------------------------
-- Member: same wall as request_payment_chase.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  $$ select * from payment_chase_preview(
       current_setting('test.gym')::uuid,
       current_setting('test.sub')::uuid) $$,
  'Not allowed',
  'member cannot read the draft'
);

-- ---------------------------------------------------------------------------
-- A subscription that is not failing has nothing to preview.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  $$ select * from payment_chase_preview(
       current_setting('test.gym')::uuid,
       gen_random_uuid()) $$,
  'That payment is not failing',
  'an unknown subscription is refused'
);

-- ---------------------------------------------------------------------------
-- A gym that never took the job on has no template and no draft.
-- ---------------------------------------------------------------------------
select _test_act_as(current_setting('test.owneroff')::uuid);

select is(
  (select count(*)::int from payment_chase_preview(
     current_setting('test.gymoff')::uuid,
     current_setting('test.suboff')::uuid)),
  0,
  'no template means zero rows, not an error'
);

select * from finish();
rollback;
