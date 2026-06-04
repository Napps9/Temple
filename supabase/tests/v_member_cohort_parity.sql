-- Invariant: v_member_cohort's per-row flags match the TS classifier
-- in src/lib/insights.ts for the shared fixture set
-- (src/lib/insights.fixtures.ts).
--
-- This is the SQL half of the SQL↔TS parity story, mirroring the
-- pattern in booking-picker. Each scenario here corresponds to a
-- named fixture on the TS side; both implementations must agree on
-- the flag set.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@parity.test');
  v_gym   uuid := _test_mk_gym('Parity Gym', 'parity');
  -- One member per scenario; the fixture order matches insights.fixtures.ts.
  v_m_pure_intro     uuid := _test_mk_user('m1@parity.test');
  v_m_intro_expiring uuid := _test_mk_user('m2@parity.test');
  v_m_converted      uuid := _test_mk_user('m3@parity.test');
  v_m_expiring_sub   uuid := _test_mk_user('m4@parity.test');
  v_m_expired        uuid := _test_mk_user('m5@parity.test');
  v_m_refunded       uuid := _test_mk_user('m6@parity.test');
  v_m_fresh          uuid := _test_mk_user('m7@parity.test');
  v_m_revoked        uuid := _test_mk_user('m8@parity.test');
  v_plan_unlimited   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,            'owner');
  perform _test_mk_membership(v_gym, v_m_pure_intro,     'member');
  perform _test_mk_membership(v_gym, v_m_intro_expiring, 'member');
  perform _test_mk_membership(v_gym, v_m_converted,      'member');
  perform _test_mk_membership(v_gym, v_m_expiring_sub,   'member');
  perform _test_mk_membership(v_gym, v_m_expired,        'member');
  perform _test_mk_membership(v_gym, v_m_refunded,       'member');
  perform _test_mk_membership(v_gym, v_m_fresh,          'member');
  perform _test_mk_membership(v_gym, v_m_revoked,        'member');

  -- Plan catalog (unlimited; used by the active/refunded subs).
  insert into public.membership_plans (gym_id, name, kind)
  values (v_gym, 'Unlimited', 'unlimited')
  returning plan_id into v_plan_unlimited;

  -- pure intro: live comp, no billing.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by)
  values
    (v_gym, v_m_pure_intro, now() - interval '5 days', now() + interval '25 days', v_owner);

  -- intro expiring soon: comp ends in 3 days.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by)
  values
    (v_gym, v_m_intro_expiring, now() - interval '5 days', now() + interval '3 days', v_owner);

  -- converted intro: comp + active plan + charge.succeeded.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by)
  values
    (v_gym, v_m_converted, now() - interval '5 days', now() + interval '25 days', v_owner);
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_converted, v_gym, v_plan_unlimited, 'active'::public.plan_sub_state,
         now() + interval '40 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_converted;
  insert into public.billing_events
    (provider, provider_event_id, member_id, gym_id, kind, amount_cents, currency, occurred_at, payload)
  values
    ('stripe', 'evt_converted_'||v_m_converted::text, v_m_converted, v_gym,
     'charge.succeeded', 0, 'GBP', now() - interval '1 day', '{}'::jsonb);

  -- active sub expiring in 5 days: paying + expiring_soon.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_expiring_sub, v_gym, v_plan_unlimited, 'active'::public.plan_sub_state,
         now() + interval '5 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_expiring_sub;
  insert into public.billing_events
    (provider, provider_event_id, member_id, gym_id, kind, amount_cents, currency, occurred_at, payload)
  values
    ('stripe', 'evt_expiring_'||v_m_expiring_sub::text, v_m_expiring_sub, v_gym,
     'invoice.paid', 0, 'GBP', now() - interval '10 days', '{}'::jsonb);

  -- expired: was paying, sub is lapsed.
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_expired, v_gym, v_plan_unlimited, 'lapsed'::public.plan_sub_state,
         now() - interval '20 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_expired;
  insert into public.billing_events
    (provider, provider_event_id, member_id, gym_id, kind, amount_cents, currency, occurred_at, payload)
  values
    ('stripe', 'evt_expired_'||v_m_expired::text, v_m_expired, v_gym,
     'charge.succeeded', 0, 'GBP', now() - interval '60 days', '{}'::jsonb);

  -- refunded_retained mid-period (21 days out): paying + expired
  -- (is_active is false because refunded_retained is not in active states).
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, paid_period_end)
  select id, v_m_refunded, v_gym, v_plan_unlimited, 'refunded_retained'::public.plan_sub_state,
         now() + interval '21 days'
  from public.gym_memberships
  where gym_id = v_gym and profile_id = v_m_refunded;
  insert into public.billing_events
    (provider, provider_event_id, member_id, gym_id, kind, amount_cents, currency, occurred_at, payload)
  values
    ('stripe', 'evt_refunded_'||v_m_refunded::text, v_m_refunded, v_gym,
     'charge.succeeded', 0, 'GBP', now() - interval '40 days', '{}'::jsonb);

  -- v_m_fresh: nothing. Default member, no plan, no comp.

  -- v_m_revoked: comp grant was revoked. Ever-had-comp = true,
  -- not active, not paying => is_expired = true.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by, revoked_at)
  values
    (v_gym, v_m_revoked, now() - interval '10 days', now() + interval '20 days',
     v_owner, now() - interval '5 days');

  -- Run as owner so we have RLS visibility into all rows.
  perform _test_act_as(v_owner);

  perform set_config('test.gym',            v_gym::text,             true);
  perform set_config('test.m_pure',         v_m_pure_intro::text,     true);
  perform set_config('test.m_intro_exp',    v_m_intro_expiring::text, true);
  perform set_config('test.m_converted',    v_m_converted::text,      true);
  perform set_config('test.m_expiring_sub', v_m_expiring_sub::text,   true);
  perform set_config('test.m_expired',      v_m_expired::text,        true);
  perform set_config('test.m_refunded',     v_m_refunded::text,       true);
  perform set_config('test.m_fresh',        v_m_fresh::text,          true);
  perform set_config('test.m_revoked',      v_m_revoked::text,        true);
end;
$$;

-- Pure intro
select ok(
  (select is_intro and not is_paying and is_active and not is_expiring_soon and not is_expired
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_pure')::uuid),
  'pure intro: intro + active, not paying, not expiring, not expired'
);

-- Intro expiring soon (3 days)
select ok(
  (select is_intro and is_expiring_soon and not is_paying
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_intro_exp')::uuid),
  'intro expiring: intro + expiring_soon, not paying'
);

-- Converted intro
select ok(
  (select not is_intro and is_paying and is_active
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_converted')::uuid),
  'converted intro: not intro, paying, active'
);

-- Active sub expiring in 5 days
select ok(
  (select is_paying and is_active and is_expiring_soon and not is_intro
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_expiring_sub')::uuid),
  'expiring sub: paying + active + expiring_soon'
);

-- Expired (was paying, sub is lapsed)
select ok(
  (select is_paying and not is_active and is_expired
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_expired')::uuid),
  'expired: paying historically, not active now, is_expired'
);

-- Refunded retained mid-period (21 days out)
select ok(
  (select is_paying and not is_active and not is_expiring_soon and is_expired
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_refunded')::uuid),
  'refunded_retained: paying, not active, not expiring_soon (21d > 7), is_expired'
);

-- Fresh signup
select ok(
  (select not is_intro and not is_paying and not is_active and not is_expired and not is_expiring_soon
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_fresh')::uuid),
  'fresh signup: nothing set'
);

-- Revoked comp
select ok(
  (select not is_intro and not is_active and is_expired
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_revoked')::uuid),
  'revoked comp: not intro, not active, is_expired'
);

-- Days-until-expiry on the converted-intro row picks the nearer of plan vs comp.
-- (Comp ends ~25 days out; plan ends ~40 days out → min = ~25.)
select cmp_ok(
  (select days_until_expiry
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_converted')::uuid),
  'between',
  24,
  26,
  'converted intro days_until_expiry follows nearer of comp/plan window'
);

-- Days-until-expiry on the expiring-sub row is ~5
select cmp_ok(
  (select days_until_expiry
   from public.v_member_cohort
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.m_expiring_sub')::uuid),
  'between',
  4,
  5,
  'expiring sub days_until_expiry is in [4, 5]'
);

select * from finish();
rollback;
