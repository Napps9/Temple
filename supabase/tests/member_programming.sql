-- Per-member individualized programming (0123): staff write authz via
-- can_program_members, the free/paid entitlement gate on member reads
-- (store subscription / one-off order / flagged plan all unlock), the
-- access RPCs, PDF file rows, and the programming_only plan kind
-- (entitles programming, never books a class).
--
-- All superuser fixtures live in the first DO block — _test_act_as
-- flips the role GUC transaction-locally and there is no reliable way
-- back (see CLAUDE.md), so entitlement states are distinct member
-- fixtures rather than mid-test mutations.

begin;
select plan(33);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@mp.test');
  v_coach   uuid := _test_mk_user('coach@mp.test');
  v_staffer uuid := _test_mk_user('staffer@mp.test');
  v_free    uuid := _test_mk_user('free@mp.test');
  v_paid    uuid := _test_mk_user('paid@mp.test');
  v_sub     uuid := _test_mk_user('sub@mp.test');
  v_order   uuid := _test_mk_user('order@mp.test');
  v_plan    uuid := _test_mk_user('plan@mp.test');
  v_pt      uuid := _test_mk_user('pt@mp.test');
  v_left    uuid := _test_mk_user('left@mp.test');
  v_coach_b uuid := _test_mk_user('coachb@mp.test');
  v_gym     uuid := _test_mk_gym('MP Gym', 'mp-gym');
  v_gym_b   uuid := _test_mk_gym('MP Gym B', 'mp-gym-b');
  v_gm_plan uuid;
  v_gm_pt   uuid;
  v_prod    uuid;
  v_plan_flagged uuid;
  v_plan_plain   uuid;
  v_plan_pt      uuid;
  v_order_id     uuid;
  v_session      uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_coach,   'coach');
  perform _test_mk_membership(v_gym, v_staffer, 'staff');
  perform _test_mk_membership(v_gym, v_free,    'member');
  perform _test_mk_membership(v_gym, v_paid,    'member');
  perform _test_mk_membership(v_gym, v_sub,     'member');
  perform _test_mk_membership(v_gym, v_order,   'member');
  v_gm_plan := _test_mk_membership(v_gym, v_plan, 'member');
  v_gm_pt   := _test_mk_membership(v_gym, v_pt,   'member');
  perform _test_mk_membership(v_gym, v_left,    'member');
  perform _test_mk_membership(v_gym_b, v_coach_b, 'coach');

  update public.gym_memberships
    set left_at = now()
    where gym_id = v_gym and profile_id = v_left;

  insert into public.store_products
    (gym_id, name, kind, price_cents, track_inventory, recurring,
     recurring_interval, digital_asset_path)
    values (v_gym, 'Personal programming', 'digital', 5000, false, true,
            'month', v_gym::text || '/digital/pp.pdf')
    returning id into v_prod;

  insert into public.store_subscriptions
    (gym_id, profile_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, currency, "interval", digital_asset_path, status,
     stripe_subscription_id)
    values (v_gym, v_sub, v_prod, 'Personal programming', 'digital', 5000,
            'GBP', 'month', v_gym::text || '/digital/pp.pdf', 'active',
            'sub_mp_test');

  insert into public.store_orders
    (gym_id, profile_id, status, subtotal_cents, shipping_cents,
     total_cents, currency, paid_at)
    values (v_gym, v_order, 'paid', 5000, 0, 5000, 'GBP', now())
    returning id into v_order_id;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
    values (v_order_id, v_gym, v_prod, 'Personal programming', 'digital',
            5000, 1, 5000);

  insert into public.membership_plans
    (gym_id, name, kind, monthly_price_cents, includes_individual_programming)
    values (v_gym, 'Unlimited plus programming', 'unlimited', 9000, true)
    returning plan_id into v_plan_flagged;

  insert into public.membership_plans
    (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 7000)
    returning plan_id into v_plan_plain;

  insert into public.membership_plans
    (gym_id, name, kind, monthly_price_cents, includes_individual_programming)
    values (v_gym, 'Personal training', 'programming_only', 12000, true)
    returning plan_id into v_plan_pt;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
    values (v_gm_plan, v_plan, v_gym, v_plan_flagged, 'active'),
           (v_gm_pt,   v_pt,   v_gym, v_plan_pt,      'active');

  v_session := _test_mk_session(v_gym, v_coach, now() + interval '1 day');

  perform set_config('test.gym',          v_gym::text,          true);
  perform set_config('test.gym_b',        v_gym_b::text,        true);
  perform set_config('test.owner',        v_owner::text,        true);
  perform set_config('test.coach',        v_coach::text,        true);
  perform set_config('test.staffer',      v_staffer::text,      true);
  perform set_config('test.coach_b',      v_coach_b::text,      true);
  perform set_config('test.free',         v_free::text,         true);
  perform set_config('test.paid',         v_paid::text,         true);
  perform set_config('test.sub',          v_sub::text,          true);
  perform set_config('test.order',        v_order::text,        true);
  perform set_config('test.plan',         v_plan::text,         true);
  perform set_config('test.pt',           v_pt::text,           true);
  perform set_config('test.left',         v_left::text,         true);
  perform set_config('test.product',      v_prod::text,         true);
  perform set_config('test.plan_plain',   v_plan_plain::text,   true);
  perform set_config('test.session',      v_session::text,      true);
end $$;

-- ── Staff write path ───────────────────────────────────────────────────

do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

-- 1-2. A coach writes a member's day.
select lives_ok(
  format($$ insert into public.member_programming
    (gym_id, profile_id, date, sections, author_id)
    values (%L::uuid, %L::uuid, current_date,
      '[{"section_category":"wod","section_format":"for_time","title":"WOD","body":"21-15-9 thrusters","leaderboard_enabled":false}]'::jsonb,
      %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.coach')),
  'a coach writes individual programming for a member');

select lives_ok(
  format($$ insert into public.member_programming
    (gym_id, profile_id, date, sections, author_id)
    values (%L::uuid, %L::uuid, current_date, '[{"section_category":"strength_and_skill","section_format":"strength_sets","title":"Squat","body":"5x5","leaderboard_enabled":false}]'::jsonb, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.paid'),
    current_setting('test.coach')),
  'a coach writes a second member''s programming');

-- Remaining entitlement-state fixtures ride the same coach session.
do $$
begin
  insert into public.member_programming (gym_id, profile_id, date, sections, author_id)
  select current_setting('test.gym')::uuid, p, current_date,
         '[{"section_category":"wod","section_format":"amrap","title":"AMRAP","body":"12 min","leaderboard_enabled":false}]'::jsonb,
         current_setting('test.coach')::uuid
  from unnest(array[
    current_setting('test.sub')::uuid,
    current_setting('test.order')::uuid,
    current_setting('test.plan')::uuid,
    current_setting('test.pt')::uuid
  ]) as p;
end $$;

-- 3. No new writes for a removed member (WITH CHECK left_at guard).
select throws_ok(
  format($$ insert into public.member_programming
    (gym_id, profile_id, date, sections, author_id)
    values (%L::uuid, %L::uuid, current_date, '[]'::jsonb, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.left'),
    current_setting('test.coach')),
  '42501', null,
  'a coach cannot write programming for a removed member');

-- 4. The coach configures paid access.
select lives_ok(
  format($$ select public.set_member_programming_access(
    %L::uuid, %L::uuid, 'paid', %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.paid'),
    current_setting('test.product')),
  'a coach sets paid access with a linked product');

do $$
begin
  perform public.set_member_programming_access(
    current_setting('test.gym')::uuid, current_setting('test.sub')::uuid,
    'paid', current_setting('test.product')::uuid);
  perform public.set_member_programming_access(
    current_setting('test.gym')::uuid, current_setting('test.order')::uuid,
    'paid', current_setting('test.product')::uuid);
  perform public.set_member_programming_access(
    current_setting('test.gym')::uuid, current_setting('test.plan')::uuid,
    'paid', null);
  perform public.set_member_programming_access(
    current_setting('test.gym')::uuid, current_setting('test.pt')::uuid,
    'paid', null);
end $$;

-- 8-9 (numbered 5-6 in run order): PDF file rows.
select lives_ok(
  format($$ insert into public.member_programming_files
    (gym_id, profile_id, title, file_path, uploaded_by)
    values (%L::uuid, %L::uuid, 'Block 1', %L || '/' || %L || '/a.pdf', %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.coach')),
  'a coach uploads a programme PDF row for a member');

select lives_ok(
  format($$ insert into public.member_programming_files
    (gym_id, profile_id, title, file_path, uploaded_by)
    values (%L::uuid, %L::uuid, 'Block 1', %L || '/' || %L || '/b.pdf', %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.paid'),
    current_setting('test.gym'), current_setting('test.paid'),
    current_setting('test.coach')),
  'a coach uploads a PDF row for the paid member');

-- ── Staff-role and cross-tenant denials ────────────────────────────────

do $$ begin perform _test_act_as(current_setting('test.staffer')::uuid); end $$;

select throws_ok(
  format($$ select public.set_member_programming_access(
    %L::uuid, %L::uuid, 'free', null) $$,
    current_setting('test.gym'), current_setting('test.free')),
  null, 'Not authorised',
  'a staff-role user cannot configure programming access');

select throws_ok(
  format($$ insert into public.member_programming
    (gym_id, profile_id, date, sections, author_id)
    values (%L::uuid, %L::uuid, current_date + 1, '[]'::jsonb, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.staffer')),
  '42501', null,
  'a staff-role user cannot write individual programming');

select throws_ok(
  format($$ insert into public.member_programming_files
    (gym_id, profile_id, title, file_path, uploaded_by)
    values (%L::uuid, %L::uuid, 'Nope', 'x/y/z.pdf', %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.staffer')),
  '42501', null,
  'a staff-role user cannot add programme PDFs');

do $$ begin perform _test_act_as(current_setting('test.coach_b')::uuid); end $$;

select throws_ok(
  format($$ insert into public.member_programming
    (gym_id, profile_id, date, sections, author_id)
    values (%L::uuid, %L::uuid, current_date + 1, '[]'::jsonb, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.free'),
    current_setting('test.coach_b')),
  '42501', null,
  'a coach from another gym cannot write into this gym');

-- ── Member visibility: free vs paid ────────────────────────────────────

do $$ begin perform _test_act_as(current_setting('test.free')::uuid); end $$;

select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.free')::uuid),
  1,
  'a free-access member reads their own programming');

select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.paid')::uuid),
  0,
  'a member cannot read another member''s programming');

select is(
  (select count(*)::int from public.member_programming_files
   where profile_id = current_setting('test.free')::uuid),
  1,
  'a free-access member reads their own programme PDFs');

do $$ begin perform _test_act_as(current_setting('test.paid')::uuid); end $$;

select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.paid')::uuid),
  0,
  'paid access without a purchase hides the programming');

select is(
  (select count(*)::int from public.member_programming_files
   where profile_id = current_setting('test.paid')::uuid),
  0,
  'paid access without a purchase hides the PDFs too');

select is(
  (select entitled from public.my_programming_access(current_setting('test.gym')::uuid)),
  false,
  'my_programming_access reports the lock');

select is(
  (select has_programming from public.my_programming_access(current_setting('test.gym')::uuid)),
  true,
  'the locked member still learns a programme exists');

select is(
  (select product_id from public.my_programming_access(current_setting('test.gym')::uuid)),
  current_setting('test.product')::uuid,
  'the locked card knows which product unlocks it');

select is(
  (select plan_upgrade_available from public.my_programming_access(current_setting('test.gym')::uuid)),
  true,
  'the locked card knows a qualifying plan exists');

-- ── Each entitlement path unlocks ──────────────────────────────────────

do $$ begin perform _test_act_as(current_setting('test.sub')::uuid); end $$;
select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.sub')::uuid),
  1,
  'an active store subscription to the linked product unlocks');

do $$ begin perform _test_act_as(current_setting('test.order')::uuid); end $$;
select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.order')::uuid),
  1,
  'a paid one-off order for the linked product unlocks');

do $$ begin perform _test_act_as(current_setting('test.plan')::uuid); end $$;
select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.plan')::uuid),
  1,
  'a current subscription to a flagged plan unlocks');

-- ── programming_only plan: programming yes, booking no ─────────────────

do $$ begin perform _test_act_as(current_setting('test.pt')::uuid); end $$;

select is(
  (select count(*)::int from public.member_programming
   where profile_id = current_setting('test.pt')::uuid),
  1,
  'a programming_only plan subscription unlocks programming');

select is(
  public.is_booking_eligible(
    current_setting('test.pt')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.session')::uuid),
  false,
  'a programming_only plan is not booking-eligible');

select is(
  (select count(*)::int from public.select_default_entitlement(
    current_setting('test.pt')::uuid,
    current_setting('test.gym')::uuid,
    current_setting('test.session')::uuid)),
  0,
  'a programming_only plan never resolves as a booking entitlement');

select is(
  public.is_active_relationship(
    current_setting('test.pt')::uuid,
    current_setting('test.gym')::uuid),
  true,
  'a programming_only subscriber still counts as an active member');

-- ── Staff list RPC ─────────────────────────────────────────────────────

do $$ begin perform _test_act_as(current_setting('test.staffer')::uuid); end $$;
select throws_ok(
  format($$ select public.list_programmed_members(%L::uuid) $$,
    current_setting('test.gym')),
  null, 'Not authorised',
  'a staff-role user cannot list programmed members');

do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.list_programmed_members(
    current_setting('test.gym')::uuid)),
  6,
  'the Individuals list shows every member with rows or access config');

-- ── programming_only plan shape CHECKs + flag write path ──────────────

do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select throws_ok(
  format($$ insert into public.membership_plans
    (gym_id, name, kind, credit_count, monthly_price_cents,
     includes_individual_programming)
    values (%L::uuid, 'Bad PT', 'programming_only', 10, 5000, true) $$,
    current_setting('test.gym')),
  '23514', null,
  'a programming_only plan cannot carry credits');

select throws_ok(
  format($$ insert into public.membership_plans
    (gym_id, name, kind, monthly_price_cents,
     includes_individual_programming)
    values (%L::uuid, 'Bad PT 2', 'programming_only', 5000, false) $$,
    current_setting('test.gym')),
  '23514', null,
  'a programming_only plan must include individual programming');

select lives_ok(
  format($$ update public.membership_plans
    set includes_individual_programming = true
    where plan_id = %L::uuid $$,
    current_setting('test.plan_plain')),
  'the owner flips the includes-programming flag (the editor''s write path)');

select is(
  (select includes_individual_programming from public.membership_plans
   where plan_id = current_setting('test.plan_plain')::uuid),
  true,
  'the flag readback confirms the owner update');

do $$
begin
  perform _test_act_as(current_setting('test.coach')::uuid);
  -- Owner-gated RLS: this update silently matches zero rows.
  update public.membership_plans
    set includes_individual_programming = false
    where plan_id = current_setting('test.plan_plain')::uuid;
  perform _test_act_as(current_setting('test.owner')::uuid);
end $$;

select is(
  (select includes_individual_programming from public.membership_plans
   where plan_id = current_setting('test.plan_plain')::uuid),
  true,
  'a coach cannot flip the plan flag (owner-gated RLS)');

select * from finish();
rollback;
