-- The marketing funnel tables (0279).
--
-- Three of these are the whole reason the file exists. The demo half of the
-- funnel is recorded against tenants that are deleted and recreated every
-- night, so a row that cannot outlive its gym is a row that answers nothing
-- — test 5. The rollup must not be able to hold a real gym's screens —
-- test 4. And a visitor who never consented must leave no named row at all
-- — test 7.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sitecounts.test');
  v_real  uuid := _test_mk_gym('Real Gym', 'sitecounts-real');
  v_demo  uuid := _test_mk_gym('Demo Gym', 'demo-sitecounts');
begin
  perform _test_mk_membership(v_real, v_owner, 'owner');
  perform _test_mk_membership(v_demo, v_owner, 'owner');
  perform set_config('test.real', v_real::text, true);
  perform set_config('test.demo', v_demo::text, true);
end $$;

-- 1. The ordinary path: one call, one row, count 1.
do $$
begin
  perform public.record_site_event('pricing_viewed', '/pricing', 'google', 'mobile', '', null);
end $$;
select is(
  (select count::int from public.site_events
    where event = 'pricing_viewed' and page = '/pricing'),
  1,
  'an event lands as a row with a count of one'
);

-- 2. The same dimensions again is a count, not a second row — the same
--    property route_opens has, and the reason this is a rollup at all.
do $$
begin
  perform public.record_site_event('pricing_viewed', '/pricing', 'google', 'mobile', '', null);
end $$;
select is(
  (select count::int from public.site_events
    where event = 'pricing_viewed' and page = '/pricing'),
  2,
  'the same event twice in a day is a count, not a log'
);

-- 3. An event name nobody defined is dropped rather than raised. Every
--    caller is fire-and-forget from a click handler; an exception there is
--    a broken page for the sake of a counter.
select lives_ok(
  $$ select public.record_site_event('not_a_real_event', '/pricing', 'direct', 'desktop', '', null) $$,
  'an unknown event name does not raise'
);
select is(
  (select count(*)::int from public.site_events where event = 'not_a_real_event'),
  0,
  'and writes nothing'
);

-- 4. THE GUARD. record_demo_event refuses a gym that is not a demo tenant.
--    Without this line these tables become a record of which screens a real
--    gym's staff opened, which is the exact thing 0233 exists not to be.
do $$
begin
  perform public.record_demo_event(
    current_setting('test.real')::uuid, 'demo_stop_viewed', '/management/billing', null);
end $$;
select is(
  (select count(*)::int from public.site_events where event = 'demo_stop_viewed'),
  0,
  'a real gym cannot be recorded by record_demo_event'
);

-- 5. THE OTHER GUARD. A demo gym is recorded by its slug, and the row
--    survives the gym being deleted — which is what happens to every demo
--    tenant at 03:00 every night. route_opens cascades away here; this
--    must not.
do $$
begin
  perform public.record_demo_event(
    current_setting('test.demo')::uuid, 'demo_stop_viewed', '/management/billing', null);
  delete from public.gyms where id = current_setting('test.demo')::uuid;
end $$;
select is(
  (select detail from public.site_events where event = 'demo_stop_viewed'),
  'demo-sitecounts',
  'a demo view is filed under the slug and outlives the gym'
);

-- 6. A consenting visitor gets both layers: the count above, and a named
--    row with a timestamp.
do $$
begin
  perform public.record_site_event(
    'book_demo_submitted', '/book-a-demo', 'direct', 'desktop', '',
    '11111111-1111-1111-1111-111111111111'::uuid);
end $$;
select is(
  (select count(*)::int from public.site_visits
    where visitor = '11111111-1111-1111-1111-111111111111'::uuid),
  1,
  'a consenting visitor leaves a named row'
);

-- 7. And a visitor who did not consent leaves none. This is the whole
--    difference between the two layers.
do $$
begin
  perform public.record_site_event(
    'book_demo_submitted', '/book-a-demo', 'bing', 'desktop', '', null);
end $$;
select is(
  (select count(*)::int from public.site_visits),
  1,
  'a visitor with no id adds nothing to the named layer'
);

-- 8. Ids never reach the page column, by the same three collapses
--    record_route_open uses. The privacy argument rests on this.
do $$
begin
  perform public.record_site_event(
    'site_entered',
    '/features/6b1f9e0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
    'direct', 'desktop', '', null);
end $$;
select is(
  (select count(*)::int from public.site_events
    where page ~ '[0-9a-f]{8}-[0-9a-f]{4}'),
  0,
  'a uuid in a path is collapsed before it is stored'
);

-- 9. A source is somebody else's URL. It gets flattened, not trusted.
do $$
begin
  perform public.record_site_event(
    'site_entered', '/', '<script>Evil Corp</script>', 'desktop', '', null);
end $$;
select is(
  (select count(*)::int from public.site_events where source like '%<%'),
  0,
  'a hostile utm_source is stripped rather than stored'
);

-- 10. Ninety days, the same window as route_opens.
do $$
begin
  insert into public.site_events (event, day, page, source, device, detail, count)
  values ('site_entered', current_date - 91, '/old', 'direct', 'desktop', '', 5);
  perform public.purge_expired_site_events();
end $$;
select is(
  (select count(*)::int from public.site_events where page = '/old'),
  0,
  'the purge drops a day older than ninety'
);

select * from finish();
rollback;
