-- The Timeline's campaign branch takes the newest, not an arbitrary few (0232)
--
-- 0229 aggregated every campaign the gym had ever sent on every load of
-- the staff home screen. 0232 cuts the branch to the page size, which is
-- exact — a campaign older than the v_limit most recent cannot reach a
-- page of v_limit rows — and would be a silent data loss if the cut ever
-- stopped being "the most recent". A comment cannot hold that; this can.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@feedcut.test');
  v_gym   uuid := _test_mk_gym('Feed Cut Gym', 'feedcut');
  i int;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  -- Ten sends, one a day, oldest first. Nothing else happens at this gym,
  -- so every row in the feed is a campaign and the page size is the cut.
  for i in 1..10 loop
    insert into public.email_campaigns
      (gym_id, created_by, title, subject, status, sent_at)
    values (v_gym, v_owner, 'Send ' || i, 'Send ' || i, 'sent',
            now() - ((11 - i) || ' days')::interval);
  end loop;
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
end $$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.timeline_feed(
     current_setting('test.gym')::uuid, null, 3)
     where kind = 'campaign_sent'),
  3,
  'a page of three carries three sends'
);

select is(
  (select subject from public.timeline_feed(
     current_setting('test.gym')::uuid, null, 3)
     order by occurred_at desc limit 1),
  'Send 10',
  'and the newest send is on it — the cut keeps the top, not a slice from anywhere'
);

select is(
  (select count(*)::int from public.timeline_feed(
     current_setting('test.gym')::uuid, null, 3)
     where subject in ('Send 1', 'Send 2', 'Send 3')),
  0,
  'nothing from the far end of the list appears on the first page'
);

-- Paging backwards has to reach them, or the cut has hidden rows rather
-- than deferred them. now() is transaction-stable, so the cursor is the
-- exact instant Send 4 was sent and the strict `<` leaves it behind —
-- which is what a cursor is for.
select is(
  (select count(*)::int from public.timeline_feed(
     current_setting('test.gym')::uuid, now() - interval '7 days', 3)
     where subject in ('Send 1', 'Send 2', 'Send 3')),
  3,
  'and paging back to them finds all three'
);

select * from finish();
rollback;
