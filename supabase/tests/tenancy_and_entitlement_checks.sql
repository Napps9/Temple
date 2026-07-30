-- Checks that named one thing and tested another (0216).
--
-- Part one is the one an owner would notice: a member who paid, then
-- cancelled, could never drop in again at a gym that allows drop-ins,
-- because the "already holds a plan here" guard was an EXISTS with no
-- status filter. The pair that matters is tests 1 and 2 — the former
-- member gets in, the member out of credits still does not, because
-- those are the two things the same line has to do.
--
-- Part two is tenancy: pending_members' two plan columns are plain FKs
-- to membership_plans(plan_id) with no gym constraint, and both readers
-- trusted them. Every path is exercised, because the hole is reachable
-- from PostgREST directly and not only through the import RPC.
--
-- my_agreed_plan's own gym join is not asserted here: it matches on
-- auth.jwt() ->> 'email', which _test_act_as does not set. The trigger
-- and the cleanup are what actually close that path; the join is
-- belt-and-braces for a row that can no longer exist.

begin;
select plan(12);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@tenancy.test');
  v_former uuid := _test_mk_user('former@tenancy.test');  -- paid, then cancelled
  v_spent  uuid := _test_mk_user('spent@tenancy.test');   -- active pack, no credits
  v_never  uuid := _test_mk_user('never@tenancy.test');   -- no history at all
  v_gym    uuid := _test_mk_gym('Drop In', 'tenancy');
  v_else   uuid := _test_mk_gym('Elsewhere', 'tenancyelse');
  v_ct     uuid;
  v_unlim  uuid;
  v_pack   uuid;
  v_theirs uuid;
  v_s1     uuid;
  v_s2     uuid;
  v_s3     uuid;
  v_pend   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_former, 'member');
  perform _test_mk_membership(v_gym, v_spent,  'member');
  perform _test_mk_membership(v_gym, v_never,  'member');
  perform _test_mk_membership(v_else, v_owner, 'owner');

  -- Drop-ins allowed: without this the gym-wide requirement refuses
  -- everyone equally and the bug is invisible.
  update public.gyms set require_membership_to_book = false where id = v_gym;

  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_gym, 'Unlimited', 'unlimited', 5000) returning plan_id into v_unlim;
  insert into public.membership_plans (gym_id, name, kind, credit_count)
    values (v_gym, 'Ten pack', 'credit_pack', 10) returning plan_id into v_pack;
  insert into public.membership_plans (gym_id, name, kind, monthly_price_cents)
    values (v_else, 'Theirs', 'unlimited', 4000) returning plan_id into v_theirs;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, price_cents, imported_legacy)
  values (
    (select id from public.gym_memberships where gym_id = v_gym and profile_id = v_former),
    v_former, v_gym, v_unlim, 'cancelled'::public.plan_sub_state, 5000, true);

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, credit_balance, imported_legacy)
  values (
    (select id from public.gym_memberships where gym_id = v_gym and profile_id = v_spent),
    v_spent, v_gym, v_pack, 'active'::public.plan_sub_state, 0, true);

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Open gym', '#10B981') returning id into v_ct;
  v_s1 := _test_mk_session(v_gym, v_owner, now() + interval '2 days', 60, v_ct);
  v_s2 := _test_mk_session(v_gym, v_owner, now() + interval '3 days', 60, v_ct);
  v_s3 := _test_mk_session(v_gym, v_owner, now() + interval '4 days', 60, v_ct);

  insert into public.pending_members (gym_id, email, full_name, created_by)
    values (v_gym, 'waiting@tenancy.test', 'Wai Ting', v_owner)
    returning id into v_pend;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.former', v_former::text, true);
  perform set_config('test.spent',  v_spent::text,  true);
  perform set_config('test.never',  v_never::text,  true);
  perform set_config('test.s1',     v_s1::text,     true);
  perform set_config('test.s2',     v_s2::text,     true);
  perform set_config('test.s3',     v_s3::text,     true);
  perform set_config('test.unlim',  v_unlim::text,  true);
  perform set_config('test.theirs', v_theirs::text, true);
  perform set_config('test.pend',   v_pend::text,   true);
end;
$$;

-- ============================================================================
-- A cancelled membership is not a membership you hold
-- ============================================================================

select _test_act_as(current_setting('test.former')::uuid);

select lives_ok(
  $$ select public.book_class(current_setting('test.s1')::uuid) $$,
  'someone who paid, then cancelled, can drop in again — they are no worse off than a stranger'
);

select _test_act_as(current_setting('test.spent')::uuid);

-- The whole point of the guard, and it has to survive the fix: an active
-- pack at zero credits is not terminal, so it still blocks.
select throws_ok(
  $$ select public.book_class(current_setting('test.s2')::uuid) $$,
  'Membership required: no active plan or credits cover this class',
  'while a member who has run out of credits still cannot book past them'
);

select _test_act_as(current_setting('test.never')::uuid);

select lives_ok(
  $$ select public.book_class(current_setting('test.s3')::uuid) $$,
  'and someone with no history at all books, as they always could'
);

-- ============================================================================
-- A pending member's plan belongs to their own gym
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

-- The hole as it was actually reachable: a column-blind update policy and
-- a bare uuid, no import RPC involved. The column-level grant in part 4 is
-- what shuts this path — the plan columns are not the client's to write at
-- all now, foreign or otherwise.
select throws_ok(
  $$ update public.pending_members
       set linked_membership_plan_id = current_setting('test.theirs')::uuid
       where id = current_setting('test.pend')::uuid $$,
  '42501',
  null,
  'a staff account cannot PATCH the plan column through PostgREST at all'
);

select throws_ok(
  $$ update public.pending_members
       set agreed_plan_id = current_setting('test.theirs')::uuid
       where id = current_setting('test.pend')::uuid $$,
  '42501',
  null,
  'nor the agent-staged plan column'
);

select throws_ok(
  $$ insert into public.pending_members
       (gym_id, email, full_name, linked_membership_plan_id, created_by)
     values (
       current_setting('test.gym')::uuid, 'new@tenancy.test', 'New Person',
       current_setting('test.theirs')::uuid, current_setting('test.owner')::uuid) $$,
  '42501',
  null,
  'and cannot stage a pending member directly either — every path is a definer RPC'
);

-- Which leaves the definer RPCs, where the grant says nothing and the
-- trigger is the only guard. This is the earmark the chat makes.
select lives_ok(
  $$ select public.earmark_pending_member_plan(
       current_setting('test.gym')::uuid,
       current_setting('test.pend')::uuid,
       current_setting('test.unlim')::uuid,
       null) $$,
  'the owner can still earmark a plan of their own, through the RPC that does it'
);

select is(
  (select linked_membership_plan_id from public.pending_members
    where id = current_setting('test.pend')::uuid),
  current_setting('test.unlim')::uuid,
  'and it landed'
);

-- import_pending_members takes the plan id out of its jsonb payload and
-- never checked it against the gym. It is security definer, so RLS is not
-- what stops this — the trigger is.
select throws_ok(
  $$ select public.import_pending_members(
       current_setting('test.gym')::uuid,
       jsonb_build_array(jsonb_build_object(
         'email', 'imported@tenancy.test',
         'full_name', 'Im Ported',
         'linked_membership_plan_id', current_setting('test.theirs')::text))) $$,
  'Plan belongs to another gym',
  'nor can the import RPC, which never validated the plan against the gym'
);

-- ============================================================================
-- Only the columns the screen edits are the client's to write
-- ============================================================================
--
-- The update policy names no column, so the grant is the whole of the
-- decision. imported_stripe_subscription_id is the one that matters: the
-- claim trigger copies it onto the plan_subscriptions row it creates.

select ok(
  not has_column_privilege(
    'authenticated', 'public.pending_members',
    'imported_stripe_subscription_id', 'update'),
  'a staff account cannot rewrite which Stripe subscription an import carries'
);

select ok(
  not has_column_privilege('authenticated', 'public.pending_members', 'status', 'update')
  and not has_column_privilege(
    'authenticated', 'public.pending_members', 'linked_profile_id', 'update')
  and not has_column_privilege('authenticated', 'public.pending_members', 'gym_id', 'update'),
  'nor the claim bookkeeping, nor which gym the row is in'
);

-- The revoke has to leave the screen that exists still working, or it has
-- broken a feature rather than closed a hole.
select ok(
  has_column_privilege('authenticated', 'public.pending_members', 'full_name', 'update')
  and has_column_privilege('authenticated', 'public.pending_members', 'email', 'update')
  and has_column_privilege('authenticated', 'public.pending_members', 'credits_remaining', 'update')
  and has_column_privilege('authenticated', 'public.pending_members', 'unsubscribed', 'update'),
  'while the imported-member screen still edits every field it edits'
);

select finish();
rollback;
