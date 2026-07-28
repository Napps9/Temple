-- Sending a campaign later.
--
-- The authorisation split is the whole design: comms_schedule_campaign
-- checks the capability while a user exists, and the cron path
-- (_send_due_campaign) authorises on the campaign row, because under
-- pg_cron auth.uid() is null and effective_can would refuse everything.

begin;
select plan(13);

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
-- pass locally and fail in CI.
select lives_ok(
  $$ select vault.create_secret('test-service-key', 'worker_service_key') $$,
  'the one-time Vault secret is created'
);

-- pgTAP runs in one transaction where now() never moves, so due-ness is
-- simulated by moving the campaign rather than the clock.
update public.email_campaigns
  set scheduled_for = now() - interval '1 minute'
  where id = current_setting('test.camp')::uuid;

select is(
  public.dispatch_scheduled_campaigns(),
  1,
  'and picks it up once it is due'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.camp')::uuid),
  'sending',
  'flipping it to sending with its recipients snapshotted'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
    where campaign_id = current_setting('test.camp')::uuid),
  1,
  'which is the one member with a usable address'
);

select * from finish();
rollback;
