-- comms_send_campaign now reads campaign.topic_id and passes it to
-- comms_audience_rows, so per-topic suppression actually fires at
-- send time (not only when previewing the count).

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sct.test');
  v_m1    uuid := _test_mk_user('m1@sct.test');
  v_m2    uuid := _test_mk_user('m2@sct.test');
  v_gym   uuid := _test_mk_gym('Topic Send Gym', 'topic-send');
  v_cid   uuid := gen_random_uuid();
  v_topic uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1,    'member');
  perform _test_mk_membership(v_gym, v_m2,    'member');

  insert into public.gym_email_topics (gym_id, label)
    values (v_gym, 'Promos') returning id into v_topic;

  -- m2 unsubscribed from this topic only.
  insert into public.email_unsubscribes (gym_id, email, profile_id, topic_id)
    values (v_gym, 'm2@sct.test', v_m2, v_topic);

  -- Campaign on the Promos topic, default audience = all_members.
  insert into public.email_campaigns
    (id, gym_id, created_by, title, subject, topic_id)
  values
    (v_cid, v_gym, v_owner, 'Promo blast', 'Hi', v_topic);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.m1',    v_m1::text,    true);
  perform set_config('test.m2',    v_m2::text,    true);
  perform set_config('test.cid',   v_cid::text,   true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 1. Send the campaign — m2 is filtered out by the per-topic
--    suppression, leaving m1 as the only recipient.
select is(
  (select public.comms_send_campaign(
     current_setting('test.cid')::uuid, '<html></html>', 'text'))::int,
  1,
  'topic-tagged campaign suppresses members who unsubscribed from that topic'
);

-- 2. The snapshot row is m1.
select is(
  (select email from public.email_campaign_recipients
   where campaign_id = current_setting('test.cid')::uuid),
  'm1@sct.test',
  'the only snapshotted recipient is m1 — m2 was filtered by the topic'
);

select * from finish();
rollback;
