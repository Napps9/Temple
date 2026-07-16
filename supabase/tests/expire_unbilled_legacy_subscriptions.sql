-- expire_unbilled_legacy_subscriptions() lapses an imported legacy
-- subscription once its carried-over renewal date passes with no payment
-- method ever added, and leaves everything else alone: legacy rows not yet
-- due, legacy credit packs (no renewal to miss), and real Stripe-backed
-- subscriptions (governed by the webhook, not this sweep).

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@legacyexp.test');
  v_gym     uuid := _test_mk_gym('Legacy Expiry Gym', 'legacyexp');
  v_unlim   uuid;
  v_pack    uuid;
  v_overdue uuid := _test_mk_user('overdue@legacyexp.test');
  v_future  uuid := _test_mk_user('future@legacyexp.test');
  v_packmem uuid := _test_mk_user('pack@legacyexp.test');
  v_live    uuid := _test_mk_user('live@legacyexp.test');
  v_gm      uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Legacy Unlimited', 'unlimited')
    returning plan_id into v_unlim;
  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Legacy 10 Pack', 'credit_pack', 10)
    returning plan_id into v_pack;

  -- Overdue: imported legacy, still active, renewal date a month in the past.
  v_gm := _test_mk_membership(v_gym, v_overdue, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end, imported_legacy)
    values (v_gm, v_overdue, v_gym, v_unlim, 'active', now() - interval '1 month', true);

  -- Not yet due: imported legacy, renewal date a month in the future.
  v_gm := _test_mk_membership(v_gym, v_future, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end, imported_legacy)
    values (v_gm, v_future, v_gym, v_unlim, 'active', now() + interval '1 month', true);

  -- Overdue but a one-off credit pack: excluded, nothing to renew.
  v_gm := _test_mk_membership(v_gym, v_packmem, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance, paid_period_end, imported_legacy)
    values (v_gm, v_packmem, v_gym, v_pack, 'active', 10, now() - interval '1 month', true);

  -- Overdue by date, but a real Stripe-backed subscription (not legacy) --
  -- the webhook owns this one, not the sweep.
  v_gm := _test_mk_membership(v_gym, v_live, 'member');
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end, imported_legacy, stripe_subscription_id)
    values (v_gm, v_live, v_gym, v_unlim, 'active', now() - interval '1 month', false, 'sub_live');

  perform set_config('test.overdue', v_overdue::text, true);
  perform set_config('test.future',  v_future::text,  true);
  perform set_config('test.packmem', v_packmem::text, true);
  perform set_config('test.live',    v_live::text,    true);
end $$;

-- The sweep returns the number of rows it lapsed (exactly the overdue unlimited one).
select is(
  public.expire_unbilled_legacy_subscriptions(),
  1,
  'sweep lapses exactly the one overdue, unpaid legacy subscription'
);

select is(
  (select status::text from public.plan_subscriptions
     where profile_id = current_setting('test.overdue')::uuid),
  'lapsed',
  'an overdue legacy subscription with no payment method is lapsed'
);

select is(
  (select status::text from public.plan_subscriptions
     where profile_id = current_setting('test.future')::uuid),
  'active',
  'a legacy subscription not yet past its renewal date is left active'
);

select is(
  (select status::text from public.plan_subscriptions
     where profile_id = current_setting('test.packmem')::uuid),
  'active',
  'an overdue legacy credit pack is left active -- no renewal to miss'
);

select is(
  (select status::text from public.plan_subscriptions
     where profile_id = current_setting('test.live')::uuid),
  'active',
  'a real Stripe-backed subscription is untouched -- governed by the webhook, not this sweep'
);

select * from finish();
rollback;
