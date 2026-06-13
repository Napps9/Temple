-- comms_track_event: an open promotes a still-'sent' recipient to
-- 'delivered', stamps the open columns, and logs an event; an
-- unsubscribe records the opt-out + adds the address to the gym's
-- suppression list.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@trk.test');
  v_m1    uuid := _test_mk_user('m1@trk.test');
  v_gym   uuid := _test_mk_gym('Track Gym', 'track-gym');
  v_cid   uuid := gen_random_uuid();
  v_rid   uuid := gen_random_uuid();
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1,    'member');

  insert into public.email_campaigns (id, gym_id, created_by, title, subject, status)
    values (v_cid, v_gym, v_owner, 'Blast', 'Hi', 'sent');
  insert into public.email_campaign_recipients
    (id, campaign_id, gym_id, profile_id, email, status)
    values (v_rid, v_cid, v_gym, v_m1, 'm1@trk.test', 'sent');

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.cid', v_cid::text, true);
  perform set_config('test.rid', v_rid::text, true);
end;
$$;

-- Record an open.
select lives_ok(
  $$ select public.comms_track_event(
       current_setting('test.cid')::uuid,
       current_setting('test.rid')::uuid, 'open') $$,
  'an open is recorded without error'
);

select is(
  (select open_count from public.email_campaign_recipients
    where id = current_setting('test.rid')::uuid),
  1,
  'open_count is incremented'
);

select is(
  (select status from public.email_campaign_recipients
    where id = current_setting('test.rid')::uuid),
  'delivered',
  'an open promotes a sent recipient to delivered'
);

select is(
  (select count(*) from public.email_events
    where recipient_id = current_setting('test.rid')::uuid and kind = 'open')::int,
  1,
  'an open event row is logged'
);

-- Record an unsubscribe.
do $$
begin
  perform public.comms_track_event(
    current_setting('test.cid')::uuid,
    current_setting('test.rid')::uuid, 'unsubscribe');
end;
$$;

select isnt(
  (select unsubscribed_at from public.email_campaign_recipients
    where id = current_setting('test.rid')::uuid),
  null,
  'the recipient is stamped unsubscribed'
);

select is(
  (select count(*) from public.email_unsubscribes
    where gym_id = current_setting('test.gym')::uuid
      and lower(email) = 'm1@trk.test')::int,
  1,
  'the address is added to the gym suppression list'
);

select * from finish();
rollback;
