-- Sending a campaign later.
--
-- The authorisation split is the whole design: comms_schedule_campaign
-- checks the capability while a user exists, and the cron path
-- (_send_due_campaign) authorises on the campaign row, because under
-- pg_cron auth.uid() is null and effective_can would refuse everything.

begin;
select plan(21);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sched.test');
  v_coach uuid := _test_mk_user('coach@sched.test');
  v_m1    uuid := _test_mk_user('m1@sched.test');
  v_gym   uuid := _test_mk_gym('Scheduled', 'sched');
  v_camp  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_m1,    'member');

  insert into public.email_campaigns
    (gym_id, created_by, title, subject, status, design, audience)
  values (v_gym, v_owner, 'Sunday news', 'This week at the gym', 'draft',
          '{}'::jsonb, '{"kind":"all_members"}'::jsonb)
  returning id into v_camp;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.camp',  v_camp::text,  true);
end;
$$;

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format(
    $$ select public.comms_schedule_campaign(%L::uuid,
         now() + interval '2 days', '<p>hi</p>', 'hi') $$,
    current_setting('test.camp')
  ),
  'Not authorised',
  'a coach cannot schedule a send'
);

select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  format(
    $$ select public.comms_schedule_campaign(%L::uuid,
         now() - interval '1 hour', '<p>hi</p>', 'hi') $$,
    current_setting('test.camp')
  ),
  'Pick a time in the future',
  'and nobody can schedule one into the past'
);

select lives_ok(
  format(
    $$ select public.comms_schedule_campaign(%L::uuid,
         now() + interval '2 days', '<p>hi</p>', 'hi') $$,
    current_setting('test.camp')
  ),
  'the owner schedules it'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'scheduled',
  'which parks it in the scheduled state'
);

-- Compiled at scheduling time on purpose: what goes out has to be what was
-- approved when the button was pressed.
select is(
  (select compiled_html from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  '<p>hi</p>',
  'with the document frozen as it was when scheduled'
);

-- The dispatcher is cron-only — revoked from authenticated — so the sweep
-- assertions run as the table owner, which is exactly who pg_cron is.
select lives_ok(
  $$ select set_config('role', 'postgres', true) $$,
  'step into the role pg_cron runs as'
);

-- Not yet due, so the sweep leaves it alone.
select is(
  public.dispatch_scheduled_campaigns(),
  0,
  'the sweep ignores a campaign that is not due'
);

-- No Vault credential means the dispatcher cannot tell the worker to send.
-- It must leave the campaign alone rather than flipping it to 'sending':
-- nothing re-sweeps a 'sending' campaign, so proceeding would strand its
-- recipients permanently. This is the exact fault 0186 exists to fix, and
-- it is worth a test precisely because a skipped POST looks like a quiet
-- period.
update public.email_campaigns
  set scheduled_for = now() - interval '1 minute'
  where id = current_setting('test.camp')::uuid;

select is(
  public.dispatch_scheduled_campaigns(),
  0,
  'with no worker credential the sweep sends nothing'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'scheduled',
  'and leaves the campaign schedulable rather than stranding it'
);

-- vault.create_secret is the real API; decrypted_secrets is a view over
-- vault.secrets on hosted Supabase, so inserting into it directly would
-- pass locally and fail in CI. The dispatcher needs BOTH the shared secret
-- (the function's x-automation-secret) and the gateway key (the publishable
-- key that gets the POST past Kong) since 0199.
select lives_ok(
  $$ select vault.create_secret('test-shared-secret', 'worker_shared_secret') $$,
  'the shared secret is created'
);
select lives_ok(
  $$ select vault.create_secret('sb_publishable_test', 'worker_gateway_key') $$,
  'and the gateway key'
);

-- The editor autosaves and the UPDATE policy allows it while scheduled,
-- so the subject and the audience CAN change after the button is pressed
-- — and the banner promises they will not go out. Only the document was
-- frozen until 0193; the rest is snapshotted now, so an edit made after
-- scheduling has to be ignored by the send and must not retitle it.
update public.email_campaigns
  set subject  = 'Edited after scheduling',
      audience = '{"kind":"staff"}'::jsonb,
      scheduled_for = now() - interval '1 minute'
  where id = current_setting('test.camp')::uuid;

select is(
  public.dispatch_scheduled_campaigns(),
  1,
  'and picks it up once it is due'
);

select is(
  (select subject from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'This week at the gym',
  'sending under the approved subject, not the one edited in afterwards'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'sending',
  'flipping it to sending with its recipients snapshotted'
);

-- One member, not the two staff the audience was edited to after
-- scheduling: the snapshot decides who gets it.
select is(
  (select count(*)::int from public.email_campaign_recipients
    where campaign_id = current_setting('test.camp')::uuid),
  1,
  'to the approved audience, not the one edited in afterwards'
);

-- A campaign that reached 'sending' and stalled — a 403 from the worker, a
-- cold start, a bad deploy — must be picked up again. Nothing else looks
-- at these: the sweep's first pass filters on 'scheduled', and
-- comms_send_campaign refuses any status outside draft/scheduled. Without
-- a second pass those recipients are stranded for good.
update public.email_campaigns
  set updated_at = now() - interval '30 minutes'
  where id = current_setting('test.camp')::uuid;

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'sending',
  'the campaign is stuck mid-send with its recipients still queued'
);

-- The re-poke is a no-op in tests (pg_net is stubbed), so what is under
-- test is that the sweep runs clean over a stuck campaign rather than
-- skipping or erroring on it.
select lives_ok(
  $$ select public.dispatch_scheduled_campaigns() $$,
  'and the next sweep picks it up rather than walking past it'
);

-- The other half of stuck: the worker drained every recipient and the
-- closing status write did not land. Re-poking is pointless — there is
-- nothing queued to pick up — so the recovery pass has to finish the
-- campaign itself, or it reads as sending forever on a report screen
-- whose only control is Refresh.
update public.email_campaign_recipients
  set status = 'sent'
  where campaign_id = current_setting('test.camp')::uuid;
update public.email_campaigns
  set updated_at = now() - interval '30 minutes'
  where id = current_setting('test.camp')::uuid;

select lives_ok(
  $$ select public.dispatch_scheduled_campaigns() $$,
  'the sweep runs over a campaign with nothing left queued'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'sent',
  'and closes it out as sent, because mail actually went'
);

-- Same shape, nothing delivered: that is a failure, not a success.
do $$
declare
  v_camp uuid;
begin
  insert into public.email_campaigns
    (gym_id, created_by, title, subject, status, design, audience,
     updated_at)
  values (current_setting('test.gym')::uuid,
          current_setting('test.owner')::uuid,
          'Bounced', 'Bounced', 'sending', '{}'::jsonb,
          '{"kind":"all_members"}'::jsonb, now() - interval '30 minutes')
  returning id into v_camp;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, status)
  select v_camp, current_setting('test.gym')::uuid, gm.profile_id,
         'm1@sched.test', 'failed'
    from public.gym_memberships gm
    where gm.gym_id = current_setting('test.gym')::uuid and gm.role = 'member'
    limit 1;

  perform set_config('test.bounced', v_camp::text, true);
end;
$$;

select lives_ok(
  $$ select public.dispatch_scheduled_campaigns() $$,
  'the sweep runs over a campaign whose recipients all failed'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.bounced')::uuid),
  'failed',
  'and marks it failed rather than sent'
);

select * from finish();
rollback;
