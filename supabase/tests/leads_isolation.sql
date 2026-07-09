-- Lead automation tenant isolation (0108): the new tables and RPCs keep
-- gyms apart. A different gym's owner sees none of gym A's notifications
-- or assignment rules, cannot reassign its leads, and cannot requeue its
-- sends; and a lead can only be assigned to a coach from its own gym.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner_a uuid := _test_mk_user('owner-a@iso.test');
  v_coach_a uuid := _test_mk_user('coach-a@iso.test');
  v_owner_b uuid := _test_mk_user('owner-b@iso.test');
  v_coach_b uuid := _test_mk_user('coach-b@iso.test');
  v_gym_a uuid := _test_mk_gym('Gym A', 'iso-gym-a');
  v_gym_b uuid := _test_mk_gym('Gym B', 'iso-gym-b');
  v_lead uuid;
begin
  perform _test_mk_membership(v_gym_a, v_owner_a, 'owner');
  perform _test_mk_membership(v_gym_a, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');
  perform _test_mk_membership(v_gym_b, v_coach_b, 'coach');

  insert into public.lead_assignment_rules (gym_id, strategy) values (v_gym_a, 'round_robin');

  perform _test_act_as(v_owner_a);
  v_lead := record_lead(v_gym_a, 'Gym A Prospect', 'a@iso.test');

  perform set_config('test.gym_a', v_gym_a::text, true);
  perform set_config('test.owner_a', v_owner_a::text, true);
  perform set_config('test.owner_b', v_owner_b::text, true);
  perform set_config('test.coach_b', v_coach_b::text, true);
  perform set_config('test.lead', v_lead::text, true);
  perform set_config('test.email',
    (select id from public.lead_notifications
       where lead_id = v_lead and channel = 'email')::text, true);
end $$;

-- Sanity: gym A's owner CAN see the notification (RLS isn't blanket-denying).
select cmp_ok(
  (select count(*)::int from public.lead_notifications
     where gym_id = current_setting('test.gym_a')::uuid),
  '>=', 1,
  'gym A owner sees gym A lead notifications');

-- Switch to the outsider (gym B owner).
do $$ begin perform _test_act_as(current_setting('test.owner_b')::uuid); end $$;

-- 1. Outsider sees none of gym A's notifications.
select is(
  (select count(*)::int from public.lead_notifications
     where gym_id = current_setting('test.gym_a')::uuid),
  0,
  'a different gym''s owner cannot see gym A lead notifications via RLS');

-- 2. Outsider sees none of gym A's assignment rules.
select is(
  (select count(*)::int from public.lead_assignment_rules
     where gym_id = current_setting('test.gym_a')::uuid),
  0,
  'a different gym''s owner cannot see gym A assignment rules via RLS');

-- 3. Outsider cannot reassign gym A's lead.
select throws_like(
  format('select set_lead_assignee(%L::uuid, %L::uuid)',
    current_setting('test.lead'), current_setting('test.owner_b')),
  '%Not authorised%',
  'a different gym''s owner cannot reassign gym A''s lead');

-- 4. Outsider cannot requeue gym A's failed send.
select throws_like(
  format('select requeue_lead_notification(%L::uuid)', current_setting('test.email')),
  '%Not authorised%',
  'a different gym''s owner cannot requeue gym A''s notification');

-- 5. A lead can only be assigned to a coach from its own gym.
do $$ begin perform _test_act_as(current_setting('test.owner_a')::uuid); end $$;
select throws_like(
  format('select set_lead_assignee(%L::uuid, %L::uuid)',
    current_setting('test.lead'), current_setting('test.coach_b')),
  '%not a member of this gym%',
  'a lead cannot be assigned to a coach from another gym');

select * from finish();
rollback;
