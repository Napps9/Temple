-- 0057 wires a trigger on gym_memberships insert that auto-converts
-- a matching open lead in the same gym, within the gym's
-- lead_conversion_window_days. Stale leads stay cold; out-of-window
-- leads stay too; explicit lost stays lost.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@autolead.test');
  v_member   uuid := _test_mk_user('m@autolead.test');
  v_other    uuid := _test_mk_user('o@autolead.test');
  v_stale    uuid := _test_mk_user('stale@autolead.test');
  v_lost     uuid := _test_mk_user('lost@autolead.test');
  v_gym      uuid := _test_mk_gym('Auto-attrib Gym', 'auto-attrib');
  v_lead1    uuid;
  v_lead2    uuid;
  v_lead3    uuid;
  v_lead4    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  -- Open lead with the new member's email.
  insert into public.leads (gym_id, full_name, email, status, captured_by)
    values (v_gym, 'New Member', 'm@autolead.test',
            'contacted'::public.lead_status, v_owner)
    returning id into v_lead1;

  -- Lead with a different email — should NOT be converted.
  insert into public.leads (gym_id, full_name, email, status, captured_by)
    values (v_gym, 'Different Person', 'someone-else@example.com',
            'cold'::public.lead_status, v_owner)
    returning id into v_lead2;

  -- Lead with the stale email but captured a long time ago
  -- (outside the default 90-day window).
  insert into public.leads
    (gym_id, full_name, email, status, captured_by, captured_at)
    values (v_gym, 'Stale Lead', 'stale@autolead.test',
            'contacted'::public.lead_status, v_owner,
            now() - interval '200 days')
    returning id into v_lead3;

  -- Lead already at 'lost' — should be left alone.
  insert into public.leads (gym_id, full_name, email, status, captured_by)
    values (v_gym, 'Lost Already', 'lost@autolead.test',
            'lost'::public.lead_status, v_owner)
    returning id into v_lead4;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.stale',  v_stale::text,  true);
  perform set_config('test.lost',   v_lost::text,   true);
  perform set_config('test.lead1',  v_lead1::text,  true);
  perform set_config('test.lead2',  v_lead2::text,  true);
  perform set_config('test.lead3',  v_lead3::text,  true);
  perform set_config('test.lead4',  v_lead4::text,  true);
end $$;

-- 1. New member joins → lead1 auto-converts.
do $$ begin
  perform _test_mk_membership(
    current_setting('test.gym')::uuid,
    current_setting('test.member')::uuid,
    'member'::public.gym_role);
end $$;

select is(
  (select status::text from public.leads
   where id = current_setting('test.lead1')::uuid),
  'converted',
  'matching open lead flips to converted on signup'
);

select is(
  (select converted_profile_id::text from public.leads
   where id = current_setting('test.lead1')::uuid),
  current_setting('test.member'),
  'converted_profile_id points at the new member'
);

-- 2. Non-matching email lead stays put.
select is(
  (select status::text from public.leads
   where id = current_setting('test.lead2')::uuid),
  'cold',
  'non-matching lead untouched'
);

-- 3. Stale lead (captured outside the window) stays put when its
--    matching member signs up.
do $$ begin
  perform _test_mk_membership(
    current_setting('test.gym')::uuid,
    current_setting('test.stale')::uuid,
    'member'::public.gym_role);
end $$;

select is(
  (select status::text from public.leads
   where id = current_setting('test.lead3')::uuid),
  'contacted',
  'lead older than lead_conversion_window_days is not auto-converted'
);

-- 4. Lost lead stays lost even when its matching member signs up.
do $$ begin
  perform _test_mk_membership(
    current_setting('test.gym')::uuid,
    current_setting('test.lost')::uuid,
    'member'::public.gym_role);
end $$;

select is(
  (select status::text from public.leads
   where id = current_setting('test.lead4')::uuid),
  'lost',
  'a lead already marked lost is not auto-converted'
);

select * from finish();
rollback;
