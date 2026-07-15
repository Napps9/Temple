-- pending_members_linking — the trigger on gym_memberships INSERT
-- applies imported state to the new membership when an email match
-- is found, and only fires when a match is found.

begin;
select plan(16);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@import.test');
  v_gym   uuid := _test_mk_gym('Import Gym', 'import-gym');
  v_pend  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);

  -- Stage a pending member to claim. Direct INSERT bypasses RLS, which
  -- is fine for the fixture; the import RPC is exercised separately.
  insert into public.pending_members
    (gym_id, email, full_name, plan_name, plan_end,
     credits_remaining, tags, unsubscribed, status, created_by,
     phone, emergency_contact)
  values
    (v_gym, 'ADA@example.com', 'Ada Lovelace', 'Gold Monthly',
     '2099-01-01', 12, ARRAY['VIP','Founders'], true, 'pending', v_owner,
     '07700900123', 'Grace Hopper — 07700900124')
  returning id into v_pend;
  perform set_config('test.pend', v_pend::text, true);
end $$;

-- 1. A fresh signup whose email matches → trigger fires.
do $$
declare
  v_new uuid;
begin
  v_new := _test_mk_user('ada@example.com');
  perform set_config('test.ada', v_new::text, true);
  -- The trigger reads auth.users.email; case-insensitive on lookup.
  perform _test_mk_membership(
    current_setting('test.gym')::uuid, v_new, 'member');
end $$;

select is(
  (select imported_plan_name from public.gym_memberships
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid),
  'Gold Monthly',
  'imported plan_name copied onto the new membership'
);

select is(
  (select count(*)::int from public.member_tags
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid),
  2,
  'tags from the pending row are written onto the new member (VIP + Founders)'
);

-- Lock in the column shape 0047 chose, so a future "improvement" to
-- apply_pending_member_data can't silently regress to the
-- ON-CONFLICT-without-required-columns version 0046 shipped (which
-- threw the moment any imported member with tags signed up).
select is(
  (select color from public.member_tags
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid
      and label = 'VIP'),
  '#6B7280',
  'imported tags get the gym-neutral grey colour'
);

select is(
  (select source from public.member_tags
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid
      and label = 'VIP'),
  'manual',
  'imported tags are written with source=manual (rule_id stays null)'
);

select is(
  (select created_by from public.member_tags
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid
      and label = 'VIP'),
  current_setting('test.ada')::uuid,
  'imported tags are attributed to the new member''s own profile'
);

select is(
  (select count(*)::int from public.email_unsubscribes
    where gym_id = current_setting('test.gym')::uuid
      and lower(email) = 'ada@example.com'),
  1,
  'unsubscribed=true on the pending row populates the suppression list'
);

select is(
  (select phone from public.profiles
    where id = current_setting('test.ada')::uuid),
  '07700900123',
  'pending.phone is written onto the new profile'
);

select is(
  (select emergency_contact from public.gym_memberships
    where profile_id = current_setting('test.ada')::uuid
      and gym_id = current_setting('test.gym')::uuid),
  'Grace Hopper — 07700900124',
  'pending.emergency_contact is written onto the new membership'
);

select is(
  (select status from public.pending_members
    where id = current_setting('test.pend')::uuid),
  'linked',
  'the pending row is marked linked once consumed'
);

-- 2. A fresh signup with no matching pending row → no imported data.
do $$
declare
  v_new uuid;
begin
  v_new := _test_mk_user('eve@elsewhere.test');
  perform set_config('test.eve', v_new::text, true);
  perform _test_mk_membership(
    current_setting('test.gym')::uuid, v_new, 'member');
end $$;

select is(
  (select imported_plan_name from public.gym_memberships
    where profile_id = current_setting('test.eve')::uuid
      and gym_id = current_setting('test.gym')::uuid),
  null,
  'a signup with no matching pending row gets no imported metadata'
);

-- 3. A second insert (e.g. fixture creating membership in another
--    gym) doesn't re-link the same pending row from gym A.
do $$
declare
  v_gym2 uuid := _test_mk_gym('Other Gym', 'other-gym');
begin
  perform _test_mk_membership(
    v_gym2, current_setting('test.ada')::uuid, 'member');
end $$;

select is(
  (select count(*)::int from public.pending_members
    where status = 'linked'
      and gym_id = current_setting('test.gym')::uuid),
  1,
  'pending row in gym A is unaffected by a membership creation in gym B'
);

-- 4. linked_membership_plan_id → auto-creates a plan_subscription.
-- Set up a second gym with a plan, stage a pending row pointing at it,
-- sign that member up, and verify the subscription gets created with
-- credit_balance / paid_period_end / status pulled from the right
-- places.
do $$
declare
  v_gym3   uuid := _test_mk_gym('Sub-creating Gym', 'sub-gym');
  v_owner3 uuid := _test_mk_user('owner@sub.test');
  v_plan   uuid;
  v_pend2  uuid;
begin
  perform _test_mk_membership(v_gym3, v_owner3, 'owner');

  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym3, 'Imported 12 Pack', 'credit_pack', 12)
    returning plan_id into v_plan;

  insert into public.pending_members
    (gym_id, email, full_name, plan_name, plan_end,
     credits_remaining, linked_membership_plan_id, status, created_by)
  values
    (v_gym3, 'leo@example.com', 'Leo Stone', 'Imported 12 Pack',
     '2099-06-01', 7, v_plan, 'pending', v_owner3)
  returning id into v_pend2;

  perform set_config('test.gym3',  v_gym3::text,  true);
  perform set_config('test.plan',  v_plan::text,  true);
  perform set_config('test.pend2', v_pend2::text, true);
end $$;

do $$
declare
  v_new uuid := _test_mk_user('leo@example.com');
begin
  perform set_config('test.leo', v_new::text, true);
  perform _test_mk_membership(
    current_setting('test.gym3')::uuid, v_new, 'member');
end $$;

select is(
  (select count(*)::int from public.plan_subscriptions
    where profile_id = current_setting('test.leo')::uuid
      and gym_id = current_setting('test.gym3')::uuid),
  1,
  'linked_membership_plan_id → one plan_subscription created on signup'
);

select is(
  (select status::text from public.plan_subscriptions
    where profile_id = current_setting('test.leo')::uuid
      and gym_id = current_setting('test.gym3')::uuid),
  'active',
  'imported plan_subscription starts active'
);

select is(
  (select credit_balance from public.plan_subscriptions
    where profile_id = current_setting('test.leo')::uuid
      and gym_id = current_setting('test.gym3')::uuid),
  7,
  'credit_balance = pending.credits_remaining (not plan.credit_count) for credit-based plans'
);

select is(
  (select paid_period_end::date::text from public.plan_subscriptions
    where profile_id = current_setting('test.leo')::uuid
      and gym_id = current_setting('test.gym3')::uuid),
  '2099-06-01',
  'paid_period_end = pending.plan_end so existing booking gate handles lapse'
);

-- 5. An active recurring membership's real CSV export leaves Membership
--    End Date blank (it's ongoing) but carries a Next Bill Date — that
--    should fill paid_period_end so the plan doesn't silently vanish
--    from renewal-risk reporting, without needing plan_end at all.
do $$
declare
  v_gym3   uuid := current_setting('test.gym3')::uuid;
  v_owner3 uuid;
  v_plan2  uuid;
  v_pend3  uuid;
begin
  select profile_id into v_owner3
    from public.gym_memberships
    where gym_id = v_gym3 and role = 'owner';

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym3, 'Monthly Unlimited', 'unlimited')
    returning plan_id into v_plan2;

  insert into public.pending_members
    (gym_id, email, full_name, plan_name, next_bill_date,
     linked_membership_plan_id, status, created_by)
  values
    (v_gym3, 'mia@example.com', 'Mia Grant',
     'Monthly Unlimited', '2099-08-15', v_plan2, 'pending', v_owner3)
  returning id into v_pend3;

  perform set_config('test.mia', _test_mk_user('mia@example.com')::text, true);
  perform _test_mk_membership(
    current_setting('test.gym3')::uuid, current_setting('test.mia')::uuid, 'member');
end $$;

select is(
  (select paid_period_end::date::text from public.plan_subscriptions
    where profile_id = current_setting('test.mia')::uuid
      and gym_id = current_setting('test.gym3')::uuid),
  '2099-08-15',
  'paid_period_end falls back to pending.next_bill_date when plan_end is blank'
);

select * from finish();
rollback;
