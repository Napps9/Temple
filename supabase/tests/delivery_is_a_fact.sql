-- What happened to the email (0229)
--
-- The three numbers this suite exists to keep honest: sent is what left,
-- delivered is what arrived, successful is what arrived and stayed
-- arrived. Before 0229 all three were the same number and the third was
-- the only one anybody looked at.

begin;
select plan(27);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@delivery.test');
  v_coach uuid := _test_mk_user('coach@delivery.test');
  v_good  uuid := _test_mk_user('good@delivery.test');
  v_gone  uuid := _test_mk_user('gone@delivery.test');
  v_cross uuid := _test_mk_user('cross@delivery.test');
  v_gym   uuid := _test_mk_gym('Delivery Gym', 'delivery');
  v_camp  uuid;
  v_old   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_good,  'member');
  perform _test_mk_membership(v_gym, v_gone,  'member');
  perform _test_mk_membership(v_gym, v_cross, 'member');

  insert into public.email_campaigns (gym_id, created_by, title, subject, status, sent_at)
  values (v_gym, v_owner, 'Christmas hours', 'Christmas hours', 'sent', now())
  returning id into v_camp;

  -- A send from before anybody was listening: no events will ever land.
  insert into public.email_campaigns (gym_id, created_by, title, subject, status, sent_at)
  values (v_gym, v_owner, 'Last summer', 'Last summer', 'sent', now() - interval '200 days')
  returning id into v_old;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, status, sent_at, provider_message_id)
  values
    (v_camp, v_gym, v_good,  'good@delivery.test',  'sent', now(), 'msg-good'),
    (v_camp, v_gym, v_gone,  'gone@delivery.test',  'sent', now(), 'msg-gone'),
    (v_camp, v_gym, v_cross, 'cross@delivery.test', 'sent', now(), 'msg-cross'),
    (v_camp, v_gym, null,    'soft@delivery.test',  'sent', now(), 'msg-soft');

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, email, status, sent_at)
  values (v_old, v_gym, 'good@delivery.test', 'sent', now() - interval '200 days');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.camp',  v_camp::text,  true);
  perform set_config('test.old',   v_old::text,   true);
end $$;

-- ---------------------------------------------------------------------------
-- Nobody with a browser can write a delivery event
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute'),
  'only the service role may say what happened to an email'
) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'comms_apply_delivery_event';

-- ---------------------------------------------------------------------------
-- An arrival
-- ---------------------------------------------------------------------------

select is(
  public.comms_apply_delivery_event('msg-good', 'delivered'),
  true,
  'a delivery report finds its recipient by the provider message id'
);

select isnt(
  (select delivered_at from public.email_campaign_recipients
     where provider_message_id = 'msg-good'),
  null,
  'and stamps the moment it arrived, which nothing has ever done before'
);

select is(
  (select status from public.email_campaign_recipients
     where provider_message_id = 'msg-good'),
  'delivered',
  'the recipient is delivered rather than merely sent'
);

select is(
  (select delivery_tracked from public.email_campaigns
     where id = current_setting('test.camp')::uuid),
  true,
  'and the campaign now knows its report is measuring something'
);

select is(
  (select delivery_tracked from public.email_campaigns
     where id = current_setting('test.old')::uuid),
  false,
  'while a send nobody was listening to stays marked unmeasured, not zero'
);

-- ---------------------------------------------------------------------------
-- A bounce that is permanent
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.comms_apply_delivery_event(
      'msg-gone', 'bounced', true, 'NoEmail: mailbox does not exist')$$,
  'a permanent bounce is applied'
);

select is(
  (select status from public.email_campaign_recipients
     where provider_message_id = 'msg-gone'),
  'bounced',
  'the recipient bounced — a status that until now nothing could produce'
);

select is(
  (select reason from public.email_suppressions
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'gone@delivery.test'),
  'hard_bounce',
  'and the address is suppressed'
);

-- The whole point of suppressing: the next send does not try again.
select is(
  (select count(*)::int
     from public.comms_audience_rows(
       current_setting('test.gym')::uuid, '{"kind":"all_members"}'::jsonb, null)
     where lower(email) = 'gone@delivery.test'),
  0,
  'the next audience leaves them out'
);

select is(
  (select count(*)::int
     from public.comms_audience_rows(
       current_setting('test.gym')::uuid, '{"kind":"all_members"}'::jsonb, null)
     where lower(email) = 'good@delivery.test'),
  1,
  'and leaves everybody else in'
);

-- ---------------------------------------------------------------------------
-- A bounce that is not
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.comms_apply_delivery_event(
      'msg-soft', 'bounced', false, 'General: mailbox full')$$,
  'a transient bounce is applied too'
);

select is(
  (select status from public.email_campaign_recipients
     where provider_message_id = 'msg-soft'),
  'sent',
  'but it does not condemn the recipient — the provider is still trying'
);

select is(
  (select count(*)::int from public.email_suppressions
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'soft@delivery.test'),
  0,
  'and does not suppress a full mailbox for ever'
);

select is(
  (select count(*)::int from public.email_events
     where campaign_id = current_setting('test.camp')::uuid and kind = 'bounce'),
  2,
  'both bounces are on the record, permanent or not'
);

-- ---------------------------------------------------------------------------
-- A complaint
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.comms_apply_delivery_event('msg-cross', 'complained')$$,
  'somebody pressed "this is spam"'
);

select isnt(
  (select complained_at from public.email_campaign_recipients
     where provider_message_id = 'msg-cross'),
  null,
  'which is recorded against them'
);

-- A complaint outranks a bounce: run it over the already-bounced address
-- and the stronger reason has to win, or a later cleared bounce would
-- quietly re-enable somebody who reported the gym for spam.
select lives_ok(
  $$select public.comms_apply_delivery_event('msg-gone', 'complained')$$,
  'and the same person can do both'
);

select is(
  (select reason from public.email_suppressions
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'gone@delivery.test'),
  'complaint',
  'a complaint outranks a bounce on the same address'
);

-- ---------------------------------------------------------------------------
-- An id from somebody else's mail
-- ---------------------------------------------------------------------------

select is(
  public.comms_apply_delivery_event('msg-nobody', 'delivered'),
  false,
  'an unknown message id says so rather than raising — transactional mail reports here too'
);

-- ---------------------------------------------------------------------------
-- The three numbers
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

-- msg-good delivered; msg-gone bounced; msg-cross and msg-soft neither.
select is(
  (select sent from public.comms_campaign_stats(current_setting('test.camp')::uuid)),
  4,
  'sent counts everything that left, bounces included'
);

select is(
  (select delivered from public.comms_campaign_stats(current_setting('test.camp')::uuid)),
  1,
  'delivered counts what a mailbox took'
);

select is(
  (select successful from public.comms_campaign_stats(current_setting('test.camp')::uuid)),
  1,
  'and successful is delivered and not bounced'
);

-- ---------------------------------------------------------------------------
-- And the owner is told without going looking
-- ---------------------------------------------------------------------------

select is(
  (select (detail->>'successful')::int
     from public.timeline_feed(current_setting('test.gym')::uuid, null, 100)
     where item_id = 'campaign:' || current_setting('test.camp')),
  1,
  'the send appears in the Timeline carrying what actually arrived'
);

select is(
  (select (detail->>'bounced')::int
     from public.timeline_feed(current_setting('test.gym')::uuid, null, 100)
     where item_id = 'campaign:' || current_setting('test.camp')),
  1,
  'and the bounce, which is the half an owner would otherwise never see'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format('select * from public.comms_campaign_stats(%L::uuid)', current_setting('test.camp')),
  null, 'Not authorised',
  'a coach without can_manage_comms is not shown the report'
);

select is(
  (select count(*)::int
     from public.timeline_feed(current_setting('test.gym')::uuid, null, 100)
     where kind = 'campaign_sent'),
  0,
  'nor the send receipt in their Timeline'
);

select * from finish();
rollback;
