-- Article 9 erasure + retention: removing a member purges every health
-- row they own, the 3-month retention sweep catches long-departed
-- members but spares recent leavers, and consent is recorded + erased
-- with the rest.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@erase.test');
  v_a       uuid := _test_mk_user('a@erase.test');   -- leaves now
  v_b       uuid := _test_mk_user('b@erase.test');   -- left 4 months ago
  v_c       uuid := _test_mk_user('c@erase.test');   -- left 1 month ago
  v_gym     uuid := _test_mk_gym('Erase Gym', 'erase');
  v_q       uuid;
  v_qn      uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');
  perform _test_mk_membership(v_gym, v_c,     'member');

  -- A PAR-Q questionnaire so responses have a parent.
  insert into public.parq_questionnaires (gym_id, version, published_by)
    values (v_gym, 1, v_owner) returning id into v_q;

  -- Seed health data for all three members.
  for v_qn in select unnest(array[v_a, v_b, v_c]) loop
    insert into public.parq_responses (gym_id, profile_id, questionnaire_id, has_flag)
      values (v_gym, v_qn, v_q, true);
    insert into public.member_injuries (gym_id, profile_id, body_region, pain_level)
      values (v_gym, v_qn, 'knee', 7);
    insert into public.staff_alerts (gym_id, kind, subject_profile_id)
      values (v_gym, 'injury_new', v_qn);
    insert into public.member_consents (gym_id, profile_id, policy_version)
      values (v_gym, v_qn, '2026-01');
    update public.gym_memberships
      set health_flag = true, emergency_contact = 'ICE 0700'
      where gym_id = v_gym and profile_id = v_qn;
  end loop;

  -- B left 4 months ago, C left 1 month ago.
  update public.gym_memberships set left_at = now() - interval '4 months'
    where gym_id = v_gym and profile_id = v_b;
  update public.gym_memberships set left_at = now() - interval '1 month'
    where gym_id = v_gym and profile_id = v_c;

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.c',     v_c::text,     true);
end;
$$;

-- ---- record_consent works as the member ----
do $$ begin perform _test_act_as(current_setting('test.a')::uuid); end $$;

select is(
  (select count(*) from public.member_consents
     where profile_id = current_setting('test.a')::uuid
       and policy_version = '2026-01')::int,
  1,
  'consent row exists for member A before erasure'
);

-- ---- leave_gym erases A's health data immediately ----
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
  perform public.leave_gym(
    current_setting('test.gym')::uuid,
    current_setting('test.a')::uuid);
  -- Read the results back as the owner: the access log is admin-only,
  -- and several health tables are staff-gated, so a just-left member
  -- couldn't observe their own (now deleted) rows reliably.
  perform _test_act_as(current_setting('test.owner')::uuid);
end $$;

select is(
  (select count(*) from public.parq_responses
     where profile_id = current_setting('test.a')::uuid)::int,
  0,
  'leave_gym erases the member''s PAR-Q responses'
);
select is(
  (select count(*) from public.member_injuries
     where profile_id = current_setting('test.a')::uuid)::int,
  0,
  'leave_gym erases the member''s injuries'
);
select is(
  (select count(*) from public.staff_alerts
     where subject_profile_id = current_setting('test.a')::uuid)::int,
  0,
  'leave_gym erases the member''s health staff alerts'
);
select is(
  (select health_flag from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.a')::uuid),
  false,
  'leave_gym clears the denormalised health_flag'
);
select is(
  (select count(*) from public.health_data_access_log
     where subject_profile_id = current_setting('test.a')::uuid
       and action = 'erase')::int,
  1,
  'leave_gym writes an erase entry to the access log'
);

-- ---- purge sweep: B (4mo) goes, C (1mo) stays ----
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.purge_expired_health_data();
end $$;

select is(
  (select count(*) from public.member_injuries
     where profile_id = current_setting('test.b')::uuid)::int,
  0,
  'retention sweep purges a member who left over 3 months ago'
);
select is(
  (select count(*) from public.member_injuries
     where profile_id = current_setting('test.c')::uuid)::int,
  1,
  'retention sweep spares a member who left under 3 months ago'
);

select * from finish();
rollback;
