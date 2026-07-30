-- Staff putting a member on a plan (0211).
--
-- The assertion that matters most here is the booking one. _book_class_for's
-- require-membership gate (0103:198-204) tests for the mere EXISTENCE of a
-- plan_subscriptions row with no status filter, so any row that is not
-- entitling doesn't just fail to help — it permanently stops that member
-- self-booking anything an entitlement doesn't cover. "The assigned member
-- can book" is therefore the only proof that the row is the right shape;
-- reading its columns back is not enough.
--
-- The second-most valuable is the price on a switch. price_cents is
-- snapshotted by a BEFORE INSERT trigger only (0015:71-73), so an UPDATE
-- that moves plan_id without writing price_cents silently grandfathers the
-- member onto the old plan's price. That failure is invisible until a
-- renewal, which is exactly the kind that needs a test rather than a
-- reviewer.

begin;
select plan(39);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@assignplan.test');
  v_admin   uuid := _test_mk_user('admin@assignplan.test');
  v_coach   uuid := _test_mk_user('coach@assignplan.test');
  v_fresh   uuid := _test_mk_user('fresh@assignplan.test');
  v_packer  uuid := _test_mk_user('packer@assignplan.test');
  v_switch  uuid := _test_mk_user('switch@assignplan.test');
  v_carded  uuid := _test_mk_user('carded@assignplan.test');
  v_outside uuid := _test_mk_user('outside@assignplan.test');
  v_gym     uuid := _test_mk_gym('Assign Plan', 'assignplan');
  v_other   uuid := _test_mk_gym('Other Gym', 'assignother');
  v_unl     uuid;
  v_pack    uuid;
  v_off     uuid;
  v_arch    uuid;
  v_prog    uuid;
  v_foreign uuid;
  v_mid     uuid;
  v_pend    uuid;
  v_linked  uuid;
  v_adopted uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_fresh, 'member');
  perform _test_mk_membership(v_gym, v_packer, 'member');
  v_mid := _test_mk_membership(v_gym, v_switch, 'member');
  perform _test_mk_membership(v_gym, v_carded, 'member');
  perform _test_mk_membership(v_other, v_outside, 'owner');

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 8900) returning plan_id into v_unl;
  insert into public.membership_plans
      (gym_id, name, kind, credit_count, monthly_price_cents)
    values (v_gym, 'Ten pack', 'credit_pack', 10, 9000)
    returning plan_id into v_pack;
  insert into public.membership_plans
      (gym_id, name, kind, credit_count, period_length, monthly_price_cents)
    values (v_gym, 'Off-peak', 'credit_period', 8, interval '1 month', 5900)
    returning plan_id into v_off;
  insert into public.membership_plans
      (gym_id, name, kind, monthly_price_cents, archived_at)
    values (v_gym, 'Retired', 'unlimited', 4900, now())
    returning plan_id into v_arch;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'PT programming', 'programming_only', 2000)
    returning plan_id into v_prog;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_other, 'Someone else''s plan', 'unlimited', 9900)
    returning plan_id into v_foreign;

  -- Already on something, unbilled — the row a switch should edit rather
  -- than duplicate.
  insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
       paid_period_end, imported_legacy)
    values (v_mid, v_switch, v_gym, v_off, 'active'::public.plan_sub_state,
       5900, now() + interval '20 days', true);

  -- Paying by card: a row edit here would bill the old amount forever.
  insert into public.plan_subscriptions
      (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents,
       paid_period_end, stripe_subscription_id)
    values (
      (select id from public.gym_memberships
        where gym_id = v_gym and profile_id = v_carded),
      v_carded, v_gym, v_off, 'active'::public.plan_sub_state, 5900,
      now() + interval '20 days', 'sub_live_card');

  insert into public.pending_members
      (gym_id, email, full_name, plan_name, credits_remaining,
       next_bill_date, created_by)
    values (v_gym, 'notyet@assignplan.test', 'Not Yet', 'Legacy monthly', 7,
       (current_date + 5), v_owner)
    returning id into v_pend;
  -- Came across in adopt mode, still paying by card.
  insert into public.pending_members
      (gym_id, email, full_name, imported_stripe_subscription_id, created_by)
    values (v_gym, 'adopted@assignplan.test', 'Still Paying', 'sub_imported',
       v_owner)
    returning id into v_adopted;
  insert into public.pending_members (gym_id, email, full_name, status, created_by)
    values (v_gym, 'alreadyin@assignplan.test', 'Already In', 'linked', v_owner)
    returning id into v_linked;

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.admin',   v_admin::text,   true);
  perform set_config('test.coach',   v_coach::text,   true);
  perform set_config('test.fresh',   v_fresh::text,   true);
  perform set_config('test.packer',  v_packer::text,  true);
  perform set_config('test.switch',  v_switch::text,  true);
  perform set_config('test.carded',  v_carded::text,  true);
  perform set_config('test.outside', v_outside::text, true);
  perform set_config('test.unl',     v_unl::text,     true);
  perform set_config('test.pack',    v_pack::text,    true);
  perform set_config('test.off',     v_off::text,     true);
  perform set_config('test.arch',    v_arch::text,    true);
  perform set_config('test.prog',    v_prog::text,    true);
  perform set_config('test.foreign', v_foreign::text, true);
  perform set_config('test.pend',    v_pend::text,    true);
  perform set_config('test.linked',  v_linked::text,  true);
  perform set_config('test.adopted', v_adopted::text, true);
  perform set_config(
    'test.sess',
    _test_mk_session(v_gym, v_owner, now() + interval '2 days')::text,
    true
  );
end;
$$;

-- ============================================================================
-- The owner puts a member on a plan
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.unl')::uuid) $$,
  'an owner can put a member on a plan'
);

select is(
  (select status::text from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.fresh')::uuid),
  'active',
  'the membership is active, not staged — a non-entitling row would lock them out of booking'
);

select ok(
  (select stripe_subscription_id is null and imported_legacy
     from public.plan_subscriptions
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.fresh')::uuid),
  'unbilled but convertible: no Stripe subscription, and the flag checkout adopts in place'
);

select is(
  (select price_cents from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.fresh')::uuid),
  8900,
  'the price is snapshotted from the plan'
);

select ok(
  (select credit_balance is null from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.fresh')::uuid),
  'an unlimited plan carries no credit balance'
);

select ok(
  (select paid_period_end between now() + interval '27 days'
                             and now() + interval '32 days'
     from public.plan_subscriptions
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.fresh')::uuid),
  'a plan with no period of its own runs a month'
);

-- ============================================================================
-- The proof: they can actually book
-- ============================================================================

select _test_act_as(current_setting('test.fresh')::uuid);

select lives_ok(
  $$ select public.book_class(current_setting('test.sess')::uuid) $$,
  'and the member can book a class — the row is genuinely entitling'
);

select is(
  (select count(*)::int from public.class_bookings
    where class_session_id = current_setting('test.sess')::uuid
      and profile_id = current_setting('test.fresh')::uuid),
  1,
  'they are on the roster like anyone who paid'
);

-- ============================================================================
-- How long it runs follows the plan's own shape
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.packer')::uuid,
       current_setting('test.pack')::uuid) $$,
  'a class pack can be assigned'
);

select ok(
  (select paid_period_end is null and credit_balance = 10
     from public.plan_subscriptions
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.packer')::uuid),
  'a pack has no end date and its credits are the limit — which is why 0125 skips packs'
);

-- Mentioned ONCE, deliberately. `a BETWEEN x AND y` is rewritten to
-- `a >= x AND a <= y`, which copies the left operand — so a mutating RPC on
-- the left of a BETWEEN runs twice and inserts twice. That is invisible at
-- the assertion that causes it and surfaces as a wrong count later.
select is(
  (public.assign_member_plan(
     current_setting('test.gym')::uuid,
     current_setting('test.packer')::uuid,
     current_setting('test.off')::uuid,
     null, 'add') ->> 'runs_to')::date,
  (now() + interval '1 month')::date,
  'a credit_period plan runs its own period_length'
);

select is(
  (public.assign_member_plan(
     current_setting('test.gym')::uuid,
     current_setting('test.fresh')::uuid,
     current_setting('test.unl')::uuid,
     '2027-03-31'::date, 'move') ->> 'runs_to')::date,
  '2027-03-31'::date,
  'an explicit until date wins, and the last day it names counts in full'
);

-- ============================================================================
-- Moving someone who is already on something
-- ============================================================================

select is(
  (public.assign_member_plan(
     current_setting('test.gym')::uuid,
     current_setting('test.switch')::uuid,
     current_setting('test.unl')::uuid,
     null, 'move') ->> 'switched')::boolean,
  true,
  'moving an unbilled member edits the membership they already have'
);

select is(
  (select count(*)::int from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.switch')::uuid),
  1,
  'one membership, not two — their history stays continuous'
);

select is(
  (select price_cents from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.switch')::uuid),
  8900,
  'and the price moves with the plan, rather than grandfathering the old one'
);

select is(
  (select count(*)::int from public.plan_subscriptions
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.packer')::uuid),
  2,
  'adding leaves the first membership alone — a second one is sometimes what was meant'
);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.carded')::uuid,
       current_setting('test.unl')::uuid,
       null, 'move') $$,
  'Membership is billed by card',
  'a card-billed membership is refused rather than quietly edited behind Stripe''s back'
);

-- Adding beside a Stripe subscription is worse than moving it: the member's
-- own membership screen resolves ONE recurring subscription and would pick
-- the newer unbilled row, taking away their ability to cancel or switch the
-- thing they are actually paying for.
select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.carded')::uuid,
       current_setting('test.unl')::uuid,
       null, 'add') $$,
  'Membership is billed by card',
  'and adding one beside it is refused too, not just moving it'
);

-- ============================================================================
-- What it refuses
-- ============================================================================

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.foreign')::uuid) $$,
  'No such plan',
  'a plan belonging to another gym is not a plan here'
);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.arch')::uuid) $$,
  'No such plan',
  'a retired plan cannot be assigned'
);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.outside')::uuid,
       current_setting('test.unl')::uuid) $$,
  'Not a member of this gym',
  'and neither can someone who is not a member'
);

-- The row would exist without entitling, and the require-membership gate
-- tests for mere existence — so this would stop them booking classes they
-- can book for free today.
select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.prog')::uuid) $$,
  'Plan does not cover classes',
  'a programming-only plan is refused rather than silently locking them out of booking'
);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.unl')::uuid,
       (current_date - 1)) $$,
  'End date out of range',
  'an end date already gone is refused rather than written dead'
);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.unl')::uuid,
       (current_date + 400)) $$,
  'End date out of range',
  'and so is a perpetual one the nightly sweep could never reach'
);

select _test_act_as(current_setting('test.fresh')::uuid);

select throws_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       current_setting('test.unl')::uuid) $$,
  'Not authorised',
  'a member cannot put themselves on a plan'
);

select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ select public.assign_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.switch')::uuid,
       current_setting('test.off')::uuid,
       null, 'move') $$,
  'a coach can, because can_assign_plan says so'
);

-- The import list is a can_manage_staff surface (0046), and a coach who may
-- put an existing member on a plan is not thereby someone who may touch it.
select throws_ok(
  $$ select public.earmark_pending_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.pend')::uuid,
       current_setting('test.unl')::uuid) $$,
  'Not authorised',
  'but a coach cannot reach into the import list to earmark one'
);

-- ============================================================================
-- Earmarking someone who has not claimed their account
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.earmark_pending_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.pend')::uuid,
       current_setting('test.unl')::uuid) $$,
  'a member still on the import list can have a plan earmarked'
);

select ok(
  (select linked_membership_plan_id = current_setting('test.unl')::uuid
            and plan_end is not null
     from public.pending_members
     where id = current_setting('test.pend')::uuid),
  'and it is the earmark the claim trigger already knows how to honour'
);

select is(
  (select plan_name from public.pending_members
    where id = current_setting('test.pend')::uuid),
  'Unlimited',
  'the label follows the earmark, rather than leaving the old provider''s wording under it'
);

-- The two paths must buy a member the same number of days from the same
-- sentence. plan_end is cast straight into paid_period_end at claim time,
-- so both are the exclusive midnight after the last day.
select is(
  (public.earmark_pending_member_plan(
     current_setting('test.gym')::uuid,
     current_setting('test.pend')::uuid,
     current_setting('test.unl')::uuid,
     '2027-03-31'::date) ->> 'runs_to')::date,
  '2027-03-31'::date,
  'an earmark reports the same last day an assignment does'
);

select is(
  (select plan_end from public.pending_members
    where id = current_setting('test.pend')::uuid),
  '2027-04-01'::date,
  'and stores the midnight after it, so the claim does not cut that day short'
);

-- apply_pending_member_data prefers the imported credits_remaining over the
-- plan's credit_count, and falls back to next_bill_date for paid_period_end.
-- An earmark that left the import's values would land the member on the old
-- provider's balance — and on a stale 0, unable to book at all.
select ok(
  (select credits_remaining is null and next_bill_date is null
     from public.pending_members
     where id = current_setting('test.pend')::uuid),
  'an unlimited earmark clears the imported credits and bill date the claim would otherwise prefer'
);

select throws_ok(
  $$ select public.earmark_pending_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.adopted')::uuid,
       current_setting('test.unl')::uuid) $$,
  'Membership is billed by card',
  'and someone who came across still paying by card is refused, since the claim would carry that subscription onto the new plan'
);

select throws_ok(
  $$ select public.earmark_pending_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.linked')::uuid,
       current_setting('test.unl')::uuid) $$,
  'Already joined',
  'earmarking someone who already joined is refused, not silently ignored — the trigger can never fire again'
);

-- ============================================================================
-- Comping
-- ============================================================================

select lives_ok(
  $$ select public.grant_member_comp(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid,
       30, null, 'On us') $$,
  'an owner can comp a member — the first thing in Temple that ever has'
);

select ok(
  (select credits_total is null and ends_at > now() + interval '25 days'
     from public.comp_grants
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.fresh')::uuid),
  'a comp with no credit count is unmetered inside its window'
);

select _test_act_as(current_setting('test.admin')::uuid);

select lives_ok(
  $$ select public.grant_member_comp(
       current_setting('test.gym')::uuid,
       current_setting('test.packer')::uuid, 7) $$,
  'an admin can comp — the capability says owner/admin/coach, and now the write agrees'
);

select _test_act_as(current_setting('test.fresh')::uuid);

select throws_ok(
  $$ select public.grant_member_comp(
       current_setting('test.gym')::uuid,
       current_setting('test.fresh')::uuid, 30) $$,
  'Not authorised',
  'a member cannot comp themselves'
);

select * from finish();
rollback;
