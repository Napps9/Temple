-- comms_send_campaign: requires can_manage_comms, snapshots the resolved
-- audience into email_campaign_recipients, excludes unsubscribed
-- addresses, and flips the campaign to 'sending'.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@send.test');
  v_coach uuid := _test_mk_user('coach@send.test');
  v_admin uuid := _test_mk_user('admin@send.test');
  v_m1    uuid := _test_mk_user('m1@send.test');
  v_m2    uuid := _test_mk_user('m2@send.test');
  v_gym   uuid := _test_mk_gym('Send Gym', 'send-gym');
  v_cid   uuid := gen_random_uuid();
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_m1,    'member');
  perform _test_mk_membership(v_gym, v_m2,    'member');

  insert into public.email_campaigns (id, gym_id, created_by, title, subject)
    values (v_cid, v_gym, v_owner, 'Blast', 'Hello members');

  -- m2 opted out — must be excluded from the snapshot.
  insert into public.email_unsubscribes (gym_id, email)
    values (v_gym, 'm2@send.test');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.cid',   v_cid::text,   true);
end;
$$;

-- A coach (no can_manage_comms by default) is refused.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  $$ select public.comms_send_campaign(
       current_setting('test.cid')::uuid, '<html></html>', 'text') $$,
  '%Not authorised%',
  'a coach cannot send a campaign'
);

-- An admin can, and the suppression list drops m2 → one recipient.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select is(
  (select public.comms_send_campaign(
     current_setting('test.cid')::uuid, '<html></html>', 'text'))::int,
  1,
  'admin send snapshots one recipient (m2 unsubscribed is excluded)'
);

select is(
  (select status from public.email_campaigns
    where id = current_setting('test.cid')::uuid),
  'sending',
  'campaign flips to sending'
);

select is(
  (select email from public.email_campaign_recipients
    where campaign_id = current_setting('test.cid')::uuid),
  'm1@send.test',
  'the only snapshotted recipient is the non-unsubscribed member'
);

select * from finish();
rollback;
