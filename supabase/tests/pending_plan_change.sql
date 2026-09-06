-- Cancelling a scheduled plan change (0260).
--
-- pending_plan_id is written by the service role and applied by a worker,
-- so cancel_pending_plan_change is the only client-reachable write on it —
-- who may call it IS the feature: the member backing out of their own
-- change, or staff doing it for them. 'Not allowed' for anyone else is
-- what stops one member unscheduling another's switch. The dispatcher
-- checks pin the sweep to the cron_run_log convention: a run that found
-- nothing still says so, because a sweep that did nothing and a sweep
-- that could do nothing must not look the same.
--
-- All fixture writes (including the pending_* columns) happen as the
-- superuser BEFORE the first _test_act_as — RESET ROLE inside a DO block
-- is not reliable, so there is no way back once acting as a user.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@pendingchange.test');
  v_m1    uuid := _test_mk_user('member1@pendingchange.test');
  v_m2    uuid := _test_mk_user('member2@pendingchange.test');
  v_other uuid := _test_mk_user('other@pendingchange.test');
  v_gym   uuid := _test_mk_gym('Pending Change', 'pendingchange');
  v_unl   uuid;
  v_cheap uuid;
  v_mship uuid;
  v_sub1  uuid;
  v_sub2  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_other, 'member');

  insert into public.membership_plans
      (gym_id, name, kind, monthly_price_cents, notice_period_days)
    values (v_gym, 'Unlimited', 'unlimited', 8900, 30)
    returning plan_id into v_unl;
  insert into public.membership_plans
      (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
    values (v_gym, '3x a week', 'credit_period', 12, interval '1 month', 6500)
    returning plan_id into v_cheap;

  -- Renewals days outside the dispatcher's 45-minute window, so the
  -- sweep below correctly finds nothing due.
  v_mship := _test_mk_membership(v_gym, v_m1, 'member');
  insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
       paid_period_end, stripe_subscription_id,
       pending_plan_id, pending_change_not_before, pending_change_requested_at)
    values (v_mship, v_m1, v_gym, v_unl, 'active'::public.plan_sub_state, 8900,
       now() + interval '10 days', 'sub_pending_1',
       v_cheap, now() + interval '30 days', now())
    returning id into v_sub1;

  v_mship := _test_mk_membership(v_gym, v_m2, 'member');
  insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
       paid_period_end, stripe_subscription_id,
       pending_plan_id, pending_change_not_before, pending_change_requested_at)
    values (v_mship, v_m2, v_gym, v_unl, 'active'::public.plan_sub_state, 8900,
       now() + interval '10 days', 'sub_pending_2',
       v_cheap, now() + interval '30 days', now())
    returning id into v_sub2;

  perform set_config('test.m1',    v_m1::text,    true);
  perform set_config('test.other', v_other::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.sub1',  v_sub1::text,  true);
  perform set_config('test.sub2',  v_sub2::text,  true);
end;
$$;

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_subscriptions'
      and column_name in ('pending_plan_id', 'pending_change_not_before',
                          'pending_change_requested_at')),
  3,
  'the scheduled change is three columns on the subscription row'
);

-- Still the superuser here on purpose: cron_run_log has no client read.
-- The log is shared with the real scheduled job: on CI's local stack
-- pg_cron fires dispatch-plan-changes on its own minute, and a run
-- landing while this file was executing made the row count two. So the
-- count is of rows this call wrote, above the high-water mark taken
-- just before it, not of every row the job has ever logged.
select set_config(
  'test.log_before',
  coalesce(
    (select max(id) from public.cron_run_log where job_name = 'dispatch-plan-changes'),
    0
  )::text,
  true
);

select is(
  public.dispatch_plan_changes(),
  0,
  'the sweep finds nothing due when every renewal is days away'
);

select is(
  (select count(*)::int from public.cron_run_log
    where job_name = 'dispatch-plan-changes'
      and id > current_setting('test.log_before')::bigint),
  1,
  'and still writes its cron_run_log row — zero found is not zero looked'
);

select _test_act_as(current_setting('test.m1')::uuid);

select lives_ok(
  $$ select public.cancel_pending_plan_change(current_setting('test.sub1')::uuid) $$,
  'a member cancels their own scheduled change'
);

select ok(
  (select pending_plan_id is null
      and pending_change_not_before is null
      and pending_change_requested_at is null
     from public.plan_subscriptions
    where id = current_setting('test.sub1')::uuid),
  'which clears all three columns, not just the target'
);

select _test_act_as(current_setting('test.other')::uuid);

select throws_ok(
  $$ select public.cancel_pending_plan_change(current_setting('test.sub2')::uuid) $$,
  'Not allowed',
  'another member cannot unschedule someone else''s switch'
);

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.cancel_pending_plan_change(current_setting('test.sub2')::uuid) $$,
  'staff with can_assign_plan cancel on a member''s behalf'
);

select ok(
  (select pending_plan_id is null
      and pending_change_not_before is null
      and pending_change_requested_at is null
     from public.plan_subscriptions
    where id = current_setting('test.sub2')::uuid),
  'clearing the same three columns'
);

select throws_ok(
  $$ select public.cancel_pending_plan_change(current_setting('test.sub2')::uuid) $$,
  'No plan change is scheduled',
  'and cancelling with nothing pending says so instead of no-opping'
);

select * from finish();
rollback;
