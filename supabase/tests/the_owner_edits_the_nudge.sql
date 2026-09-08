-- 0284: the nudge the owner pressed Send on is the nudge that goes. An
-- edit reaches the outbound row verbatim, whether the chase was already
-- proposed by the tick or created on the spot; no edit means the
-- template render exactly as before; whitespace is not an edit.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@editnudge.test');
  v_m1    uuid := _test_mk_user('m1@editnudge.test');
  v_m2    uuid := _test_mk_user('m2@editnudge.test');
  v_m3    uuid := _test_mk_user('m3@editnudge.test');
  v_gym   uuid := _test_mk_gym('Edit Nudge Gym', 'edit-nudge-gym');
  v_plan  uuid;
  v_ms1 uuid; v_ms2 uuid; v_ms3 uuid;
  v_sub1 uuid; v_sub2 uuid; v_sub3 uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_ms1 := _test_mk_membership(v_gym, v_m1, 'member');
  v_ms2 := _test_mk_membership(v_gym, v_m2, 'member');
  v_ms3 := _test_mk_membership(v_gym, v_m3, 'member');
  update public.profiles set full_name = 'Ben Brown' where id = v_m1;
  update public.profiles set full_name = 'Ella Evans' where id = v_m2;
  update public.profiles set full_name = 'Finn Foster' where id = v_m3;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
  values (v_gym, 'Unlimited', 'unlimited', 7500) returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms1, v_m1, v_gym, v_plan, 'active', 7500) returning id into v_sub1;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms2, v_m2, v_gym, v_plan, 'active', 7500) returning id into v_sub2;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents)
  values (v_ms3, v_m3, v_gym, v_plan, 'active', 7500) returning id into v_sub3;

  -- sub1 is old enough for the tick to propose; sub2 and sub3 are the
  -- fresh failures the manual chase exists for.
  insert into public.plan_subscription_dunning
    (plan_subscription_id, profile_id, gym_id, past_due_since,
     payment_failure_count, next_payment_attempt)
  values
    (v_sub1, v_m1, v_gym, now() - interval '4 days', 2, now() + interval '2 days'),
    (v_sub2, v_m2, v_gym, now() - interval '1 day', 1, now() + interval '3 days'),
    (v_sub3, v_m3, v_gym, now() - interval '1 day', 1, now() + interval '3 days');

  insert into public.agent_authority (gym_id, action_kind, level) values
    (v_gym, 'chase_message', 'approval'),
    (v_gym, 'plan_adjustment_offer', 'approval');
  insert into public.agent_message_templates (gym_id, kind, body) values
    (v_gym, 'chase_message', 'Hi {first_name} — {gym_name}. Your {plan_name} payment needs a look.');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.sub1',  v_sub1::text,  true);
  perform set_config('test.sub2',  v_sub2::text,  true);
  perform set_config('test.sub3',  v_sub3::text,  true);
end $$;

-- Superuser phase: the tick proposes a chase for the 4-day failure.
select agent_revenue_tick();

select _test_act_as(current_setting('test.owner')::uuid);

-- 1. The tick's proposal, edited on the way out.
do $$
declare v_action uuid;
begin
  v_action := public.request_payment_chase(
    current_setting('test.gym')::uuid,
    current_setting('test.sub1')::uuid,
    '  Ben, about your membership  ',
    'Hi Ben — no panic. Sort it here and see you Thursday.');
  perform set_config('test.a1', v_action::text, true);
end $$;

select is(
  (select m.body from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a1')::uuid),
  'Hi Ben — no panic. Sort it here and see you Thursday.',
  'an edited body reaches the outbound row verbatim, even on a chase the tick had proposed'
);

select is(
  (select m.subject from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a1')::uuid),
  'Ben, about your membership',
  'and the edited subject, trimmed'
);

-- The page the owner reloads reads the preview, not the outbound row, and
-- shows it under "The nudge on its way to Ben". 0284 shipped a preview that
-- could not see an override, because the send executes in the same statement
-- that stores it — so this asserts the reload, which is what was broken.
select is(
  (select body from public.payment_chase_preview(
     current_setting('test.gym')::uuid, current_setting('test.sub1')::uuid)),
  'Hi Ben — no panic. Sort it here and see you Thursday.',
  'and the preview shows the edit back, so a reload shows what went'
);

select is(
  (select subject from public.payment_chase_preview(
     current_setting('test.gym')::uuid, current_setting('test.sub1')::uuid)),
  'Ben, about your membership',
  'subject too'
);

-- 2. A chase created on the spot, sent as written by the template.
do $$
declare v_action uuid;
begin
  v_action := public.request_payment_chase(
    current_setting('test.gym')::uuid,
    current_setting('test.sub2')::uuid);
  perform set_config('test.a2', v_action::text, true);
end $$;

select is(
  (select m.body from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a2')::uuid),
  'Hi Ella — Edit Nudge Gym. Your Unlimited payment needs a look.',
  'no edit means the template render, exactly as before'
);

select is(
  (select m.subject from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a2')::uuid),
  'About your Edit Nudge Gym membership payment',
  'with the standing subject'
);

-- The other direction: nothing was edited, so the preview must keep rendering
-- from the template rather than pinning whatever the send happened to store.
select is(
  (select body from public.payment_chase_preview(
     current_setting('test.gym')::uuid, current_setting('test.sub2')::uuid)),
  'Hi Ella — Edit Nudge Gym. Your Unlimited payment needs a look.',
  'an unedited chase still previews as the template render after it has gone'
);

-- 3. Whitespace is not an edit; a long body is bounded.
do $$
declare v_action uuid;
begin
  v_action := public.request_payment_chase(
    current_setting('test.gym')::uuid,
    current_setting('test.sub3')::uuid,
    '   ',
    repeat('x', 5000));
  perform set_config('test.a3', v_action::text, true);
end $$;

select is(
  (select m.subject from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a3')::uuid),
  'About your Edit Nudge Gym membership payment',
  'a whitespace subject falls back to the standing one'
);

select is(
  (select length(m.body) from public.agent_outbound_messages m
    where m.action_id = current_setting('test.a3')::uuid),
  4000,
  'and a body is bounded at four thousand characters'
);

select * from finish();
rollback;
