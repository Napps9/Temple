-- Waivers: publish a PDF, gate booking on a drawn signature, and
-- compose with the PAR-Q gate ("both required" when both exist). Also
-- checks the setup checklist treats a waiver as satisfying the
-- screening step on its own.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@waiver.test');
  v_member uuid := _test_mk_user('m@waiver.test');
  v_gym    uuid := _test_mk_gym('Waiver Gym', 'waiver-gym');
  v_plan   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Unlimited plan + active sub so eligibility doesn't bounce the
  -- member ahead of the screening gates.
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlim', 'unlimited') returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select id, v_member, v_gym, v_plan, 'active'::public.plan_sub_state
    from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  -- Four future sessions: two we expect blocked, two we expect to book.
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.s_blockw',
    _test_mk_session(v_gym, v_owner, now() + interval '2 days')::text, true);
  perform set_config('test.s_okw',
    _test_mk_session(v_gym, v_owner, now() + interval '3 days')::text, true);
  perform set_config('test.s_blockp',
    _test_mk_session(v_gym, v_owner, now() + interval '4 days')::text, true);
  perform set_config('test.s_okboth',
    _test_mk_session(v_gym, v_owner, now() + interval '5 days')::text, true);
end $$;

-- 1. Owner publishes a waiver → active version 1.
do $$
declare v_id uuid;
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  v_id := public.publish_waiver(
    current_setting('test.gym')::uuid,
    'Liability waiver',
    current_setting('test.gym') || '/w1.pdf',
    'https://example.com/w1.pdf');
  perform set_config('test.w1', v_id::text, true);
end $$;

select is(
  (select version from public.waiver_documents
   where gym_id = current_setting('test.gym')::uuid and is_active),
  1,
  'publish_waiver creates an active version 1'
);

-- 2. Member needs to sign before booking.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select is(
  (select needs_waiver from public.current_waiver_state(
     current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid)),
  true,
  'current_waiver_state reports needs_waiver before the member signs'
);

-- 3. Booking is blocked with the Waiver hint.
select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s_blockw')),
  '%Waiver required%',
  'book_class refuses when the gym has an unsigned active waiver'
);

-- 4. Member signs → a signature row exists.
do $$
begin
  perform public.sign_waiver(
    current_setting('test.gym')::uuid,
    current_setting('test.w1')::uuid,
    '{"paths":["M0 0 L10 10 L20 5"],"width":300,"height":150}'::jsonb);
end $$;

select is(
  (select count(*)::int from public.waiver_signatures
   where waiver_id = current_setting('test.w1')::uuid
     and profile_id = current_setting('test.member')::uuid),
  1,
  'sign_waiver records the member''s signature against the active version'
);

-- 5. needs_waiver flips false.
select is(
  (select needs_waiver from public.current_waiver_state(
     current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid)),
  false,
  'current_waiver_state reports needs_waiver false after signing'
);

-- 6. Booking now succeeds.
select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s_okw')),
  'book_class succeeds once the active waiver is signed'
);

-- 7. The setup checklist screening step is satisfied by the waiver
--    alone (no PAR-Q questionnaire exists yet).
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select is(
  (select done from public.get_gym_setup_progress(
     current_setting('test.gym')::uuid) where step_key = 'parq'),
  true,
  'a published waiver satisfies the screening setup step on its own'
);

-- 8. Owner also publishes a PAR-Q. Now both exist; the member has a
--    signature but no PAR-Q response → blocked with the PAR-Q hint
--    (both required).
do $$
declare v_q uuid;
begin
  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (current_setting('test.gym')::uuid, 1,
            current_setting('test.owner')::uuid)
    returning id into v_q;
  perform set_config('test.q', v_q::text, true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format('select book_class(%L::uuid)', current_setting('test.s_blockp')),
  '%PAR-Q required%',
  'with both published, a signed-but-unscreened member is blocked on PAR-Q'
);

-- 9. Member completes the PAR-Q too → booking succeeds (both satisfied).
do $$
begin
  insert into public.parq_responses
    (gym_id, profile_id, questionnaire_id, has_flag)
  values
    (current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid,
     current_setting('test.q')::uuid, false);
end $$;

select lives_ok(
  format('select book_class(%L::uuid)', current_setting('test.s_okboth')),
  'book_class succeeds once both the waiver and the PAR-Q are cleared'
);

-- 10. Publishing a new waiver version re-gates the member (their
--     signature was against v1).
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.publish_waiver(
    current_setting('test.gym')::uuid,
    'Liability waiver',
    current_setting('test.gym') || '/w2.pdf',
    'https://example.com/w2.pdf');
  perform _test_act_as(current_setting('test.member')::uuid);
end $$;

select is(
  (select needs_waiver from public.current_waiver_state(
     current_setting('test.gym')::uuid,
     current_setting('test.member')::uuid)),
  true,
  'publishing a new waiver version requires the member to re-sign'
);

select * from finish();
rollback;
