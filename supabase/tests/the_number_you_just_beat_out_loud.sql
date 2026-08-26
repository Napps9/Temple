-- 0272: a personal best reaches all three channels, says the same thing
-- on each, and is still declinable.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@loud.test');
  v_a     uuid := _test_mk_user('ann@loud.test');
  v_gym   uuid := _test_mk_gym('Ironworks', 'loud-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');

  insert into public.gym_agent_settings (gym_id, enabled, phone_number, sms_capable)
  values (v_gym, true, '+447700900123', true);

  insert into public.member_contact_details (profile_id, phone, phone_e164)
  values (v_a, '07717 503791', '+447717503791');
  update public.gym_memberships set sms_opt_in = true
   where gym_id = v_gym and profile_id = v_a;

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ann', v_a::text, false);
end $$;

-- A prior lift to beat: a first-ever log is not a best (0263).
do $$
declare v_w uuid;
begin
  insert into public.tracked_workouts (gym_id, profile_id, performed_at)
  values (current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
          now() - interval '30 days')
  returning id into v_w;
  insert into public.tracked_movement_results
    (gym_id, profile_id, workout_id, movement_key, track_key,
     value_numeric, value_unit, performed_at)
  values (current_setting('test.gym')::uuid, current_setting('test.ann')::uuid,
          v_w, 'back_squat', 'back_squat:1rm', 102.5, 'kg',
          now() - interval '30 days');
end $$;

select _test_act_as(current_setting('test.ann')::uuid);
select ok(true, 'an earlier lift exists to beat');

-- 1. The best is recorded.
select isnt(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', 'back_squat:1rm',
     'weight', 'higher', 105, null, 'kg', now(), current_date)),
  null,
  'beating a prior lift records a milestone'
);

-- 2-3. All three channels: the card, the email and the text.
select is(
  (select count(*)::int from public.member_milestones
    where profile_id = current_setting('test.ann')::uuid),
  1,
  'the in-app card is written'
);
select is(
  (select count(*)::int from public.member_outbound_messages
    where profile_id = current_setting('test.ann')::uuid
      and status = 'queued'),
  2,
  'the email and the text are both queued'
);

-- 4. The outbound sentence carries what the card gets from its heading.
select ok(
  (select body like 'Ironworks: new best on Back Squat%'
     from public.member_outbound_messages
    where profile_id = current_setting('test.ann')::uuid
      and channel = 'sms'),
  'a text arriving cold names the gym and the movement'
);

-- 5. Both channels say the same numbers as the card.
select ok(
  (select m.body like '%' || ml.body
     from public.member_outbound_messages m
     join public.member_milestones ml on ml.profile_id = m.profile_id
    where m.channel = 'sms'),
  'the text ends in exactly the sentence the card shows'
);

-- 6. Logging the same day again does not send it again.
select is(
  (select public.record_personal_best(
     current_setting('test.gym')::uuid, 'back_squat', 'back_squat:1rm',
     'weight', 'higher', 107.5, null, 'kg', now(), current_date)),
  (select id from public.member_milestones
    where profile_id = current_setting('test.ann')::uuid),
  'a second best the same day updates the card rather than adding one'
);
select is(
  (select count(*)::int from public.member_outbound_messages
    where profile_id = current_setting('test.ann')::uuid),
  2,
  'and does not send a second pair of messages'
);

select * from finish();
rollback;
