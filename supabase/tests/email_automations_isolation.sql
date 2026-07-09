-- Email automations (0116): tenant isolation. A different gym's owner sees
-- none of gym A's automations or runs; can_manage_comms gates config writes;
-- a topic from another gym cannot be attached.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner_a uuid := _test_mk_user('owner-a@aiso.test');
  v_member_a uuid := _test_mk_user('member-a@aiso.test');
  v_owner_b uuid := _test_mk_user('owner-b@aiso.test');
  v_gym_a uuid := _test_mk_gym('A Gym', 'aiso-a');
  v_gym_b uuid := _test_mk_gym('B Gym', 'aiso-b');
  v_auto uuid;
  v_topic_b uuid;
begin
  perform _test_mk_membership(v_gym_a, v_owner_a, 'owner');
  perform _test_mk_membership(v_gym_a, v_member_a, 'member');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');

  insert into public.gym_email_topics (gym_id, label) values (v_gym_b, 'B Topic')
    returning id into v_topic_b;

  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, compiled_html, created_by, created_at)
    values (v_gym_a, 'A Welcome', true, 'member_joined', '<html>hi</html>', v_owner_a, now() - interval '1 day')
    returning id into v_auto;
  insert into public.email_automation_runs
    (gym_id, automation_id, recipient_email, status, idempotency_key)
    values (v_gym_a, v_auto, 'x@aiso.test', 'queued', 'auto:iso:1');

  perform set_config('test.gym_a', v_gym_a::text, true);
  perform set_config('test.member_a', v_member_a::text, true);
  perform set_config('test.owner_a', v_owner_a::text, true);
  perform set_config('test.owner_b', v_owner_b::text, true);
  perform set_config('test.topic_b', v_topic_b::text, true);
end $$;

-- Switch to the outsider (gym B owner).
do $$ begin perform _test_act_as(current_setting('test.owner_b')::uuid); end $$;

-- 1. Outsider sees none of gym A's automations.
select is(
  (select count(*)::int from public.email_automations
     where gym_id = current_setting('test.gym_a')::uuid),
  0, 'a different gym''s owner cannot see gym A automations via RLS');

-- 2. Outsider sees none of gym A's runs.
select is(
  (select count(*)::int from public.email_automation_runs
     where gym_id = current_setting('test.gym_a')::uuid),
  0, 'a different gym''s owner cannot see gym A automation runs via RLS');

-- 3. A plain member cannot create an automation (can_manage_comms gate).
do $$ begin perform _test_act_as(current_setting('test.member_a')::uuid); end $$;
select throws_like(
  format($f$ insert into public.email_automations (gym_id, name, trigger_type, compiled_html, created_by)
             values (%L::uuid, 'Nope', 'member_joined', '<html/>', %L::uuid) $f$,
         current_setting('test.gym_a'), current_setting('test.member_a')),
  '%row-level security%',
  'a member without can_manage_comms cannot create an automation');

-- 4. An owner cannot attach a topic that belongs to another gym.
do $$ begin perform _test_act_as(current_setting('test.owner_a')::uuid); end $$;
select throws_like(
  format($f$ insert into public.email_automations (gym_id, name, trigger_type, topic_id, compiled_html, created_by)
             values (%L::uuid, 'X', 'member_joined', %L::uuid, '<html/>', %L::uuid) $f$,
         current_setting('test.gym_a'), current_setting('test.topic_b'), current_setting('test.owner_a')),
  '%does not belong to this gym%',
  'a topic from another gym cannot be attached to an automation');

select * from finish();
rollback;
