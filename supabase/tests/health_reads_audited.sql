-- Reading someone's injuries leaves a trace, or the audit log is decoration.
--
-- 0037 built health_data_access_log and the app surfaces called it by
-- convention. Three staff surfaces read member_injuries and only one of
-- them logged — including the gym-wide heat map, which reads every member
-- at once. These assertions move that from convention to enforcement.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@healthaud.test');
  v_coach  uuid := _test_mk_user('coach@healthaud.test');
  v_member uuid := _test_mk_user('member@healthaud.test');
  v_other  uuid := _test_mk_user('other@healthaud.test');
  v_gym    uuid := _test_mk_gym('Health Audit', 'healthaud');
  v_inj    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other,  'member');

  insert into public.member_injuries
    (gym_id, profile_id, body_region, side, description, pain_level, status)
  values (v_gym, v_member, 'knee', 'left',
          'Tweaked it on a box jump', 6, 'active')
  returning id into v_inj;

  insert into public.injury_updates
    (injury_id, gym_id, profile_id, pain_level, status, note)
  values (v_inj, v_gym, v_member, 4, 'active', 'Easier this week');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
end;
$$;

-- The member still reads their own, and it is NOT logged: self-access is
-- not third-party access, and logging it would bury the rows that matter.
select _test_act_as(current_setting('test.member')::uuid);

select is(
  (select count(*)::int from public.member_injuries),
  1,
  'the member still reads their own injuries directly'
);

select is(
  (select count(*)::int from public.health_data_access_log),
  0,
  'and reading your own body is not an access event'
);

-- The staff door off the table is closed. can_see_health_flag is no longer
-- enough on its own — the read has to go through something that logs.
select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.member_injuries),
  0,
  'a coach with the capability cannot read the table directly any more'
);

select is(
  (select count(*)::int from public.injury_updates),
  0,
  'nor the check-in trail behind it'
);

select is(
  (select count(*)::int from public.gym_member_injuries(
     current_setting('test.gym')::uuid, current_setting('test.member')::uuid)),
  1,
  'they read it through the audited RPC instead'
);

-- The gym-wide view is the one that never logged. One row per view, not
-- per member: what happened is that someone opened the whole board.
select is(
  (select count(*)::int from public.gym_open_injuries(
     current_setting('test.gym')::uuid, 'gym_overview')),
  1,
  'the gym-wide heat map reads through the audited RPC'
);

-- The log itself is owner-readable only (0037), which is why the coach who
-- just generated these rows cannot see them.
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select subject_profile_id from public.health_data_access_log
    where surface = 'member_profile' limit 1),
  current_setting('test.member')::uuid,
  'the single-member read records who was looked at'
);

select is(
  (select count(*)::int from public.health_data_access_log
    where surface = 'gym_overview'),
  1,
  'and the gym-wide one leaves its own row, which it never used to'
);

select * from finish();
rollback;
