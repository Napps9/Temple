-- A/B subject testing.
--
-- The split has to be even and it has to be decided once. Random
-- assignment on a 40-person list routinely lands 26/14, and deciding at
-- send time rather than snapshot time would re-roll on a retry and put two
-- different subjects in front of the same person.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@abtest.test');
  v_gym   uuid := _test_mk_gym('AB Test', 'abtest');
  v_camp  uuid;
  i       integer;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  -- Six members, so an even split across two variants is 3/3 and across
  -- three variants is 2/2/2 — a split that is only "roughly even" shows up.
  for i in 1..6 loop
    perform _test_mk_membership(
      v_gym, _test_mk_user('m' || i || '@abtest.test'), 'member');
  end loop;

  insert into public.email_campaigns
    (gym_id, created_by, title, subject, subject_variants, status, design,
     audience)
  values (v_gym, v_owner, 'Open day', 'Come to our open day',
          '["Open day this Saturday"]'::jsonb, 'draft', '{}'::jsonb,
          '{"kind":"all_members"}'::jsonb)
  returning id into v_camp;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.camp',  v_camp::text,  true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  public.comms_send_campaign(current_setting('test.camp')::uuid,
    '<p>hi</p>', 'hi'),
  6,
  'the campaign snapshots every reachable member'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
    where campaign_id = current_setting('test.camp')::uuid
      and subject_variant = 0),
  3,
  'half of them get the original subject'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
    where campaign_id = current_setting('test.camp')::uuid
      and subject_variant = 1),
  3,
  'and half get the variant — an even split, not an approximate one'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
    where campaign_id = current_setting('test.camp')::uuid
      and subject_variant is null),
  0,
  'nobody is left unassigned'
);

-- The readout names both lines, so an owner can see which words won
-- rather than which bucket number did.
select is(
  (select count(*)::int from public.comms_variant_stats(
     current_setting('test.camp')::uuid)),
  2,
  'the report has a row per variant'
);

select is(
  (select subject from public.comms_variant_stats(
     current_setting('test.camp')::uuid) where variant = 0),
  'Come to our open day',
  'variant 0 is the campaign own subject'
);

select is(
  (select subject from public.comms_variant_stats(
     current_setting('test.camp')::uuid) where variant = 1),
  'Open day this Saturday',
  'and the rest come off subject_variants in order'
);

select * from finish();
rollback;
