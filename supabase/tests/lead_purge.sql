-- Lead retention purge (0108): purge_expired_leads deletes unconverted
-- leads past their gym's retention window, keeps converted ones and recent
-- ones, and honours each gym's own lead_retention_days.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_member uuid := _test_mk_user('member@purge.test');
  v_gym uuid := _test_mk_gym('Purge Gym', 'purge-gym');       -- default 365-day window
  v_gym_short uuid := _test_mk_gym('Short Gym', 'short-gym');  -- 30-day window
  v_old uuid; v_recent uuid; v_conv uuid; v_short_old uuid; v_short_recent uuid;
begin
  perform _test_mk_membership(v_gym, v_member, 'member');
  update public.gyms set lead_retention_days = 30 where id = v_gym_short;

  insert into public.leads (gym_id, full_name, captured_at)
    values (v_gym, 'Old Unconverted', now() - interval '400 days') returning id into v_old;
  insert into public.leads (gym_id, full_name, captured_at)
    values (v_gym, 'Recent', now() - interval '10 days') returning id into v_recent;
  insert into public.leads (gym_id, full_name, captured_at, status, converted_profile_id, converted_at)
    values (v_gym, 'Old Converted', now() - interval '400 days',
            'converted'::public.lead_status, v_member, now() - interval '399 days')
    returning id into v_conv;
  insert into public.leads (gym_id, full_name, captured_at)
    values (v_gym_short, 'Short Old', now() - interval '60 days') returning id into v_short_old;
  insert into public.leads (gym_id, full_name, captured_at)
    values (v_gym_short, 'Short Recent', now() - interval '10 days') returning id into v_short_recent;

  perform set_config('test.old', v_old::text, true);
  perform set_config('test.recent', v_recent::text, true);
  perform set_config('test.conv', v_conv::text, true);
  perform set_config('test.short_old', v_short_old::text, true);
  perform set_config('test.short_recent', v_short_recent::text, true);
end $$;

-- Run the sweep and capture how many it removed.
do $$ begin perform set_config('test.purged', purge_expired_leads()::text, true); end $$;

-- 1. It deleted exactly the two expired unconverted leads.
select is(current_setting('test.purged')::int, 2, 'purge removes exactly the two expired leads');

-- 2. Old unconverted lead is gone.
select is(
  (select count(*)::int from public.leads where id = current_setting('test.old')::uuid),
  0, 'an old unconverted lead is purged');

-- 3. Recent lead survives.
select is(
  (select count(*)::int from public.leads where id = current_setting('test.recent')::uuid),
  1, 'a recent lead is kept');

-- 4. Converted lead survives regardless of age.
select is(
  (select count(*)::int from public.leads where id = current_setting('test.conv')::uuid),
  1, 'an old but converted lead is kept');

-- 5. The short-window gym purges its 60-day-old lead.
select is(
  (select count(*)::int from public.leads where id = current_setting('test.short_old')::uuid),
  0, 'a shorter retention window purges a 60-day-old lead');

-- 6. The short-window gym keeps its recent lead.
select is(
  (select count(*)::int from public.leads where id = current_setting('test.short_recent')::uuid),
  1, 'the short-window gym keeps its recent lead');

select * from finish();
rollback;
