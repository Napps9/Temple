-- announcement_read_stats (0253): the staff-only reach measure. Counts
-- are aggregate and scoped to current members; a plain member is
-- refused in the function, not just hidden from in the client; anon
-- cannot execute at all.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@readstats.test');
  v_coach   uuid := _test_mk_user('coach@readstats.test');
  v_member  uuid := _test_mk_user('member@readstats.test');
  v_leaver  uuid := _test_mk_user('leaver@readstats.test');
  v_out     uuid := _test_mk_user('outsider@readstats.test');
  v_gym     uuid := _test_mk_gym('Readstats Gym', 'readstats-gym');
  v_ann     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_leaver, 'member');

  insert into public.gym_announcements (gym_id, posted_by, title, body, pinned)
  values (v_gym, v_owner, 'Closed Monday', 'Cleaning the floor.', false)
  returning id into v_ann;

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.ann',    v_ann::text,    false);
  perform set_config('test.coach',  v_coach::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.leaver', v_leaver::text, false);
  perform set_config('test.out',    v_out::text,    false);
end $$;

-- 1. The coach (a can_post_announcements holder) gets the counts:
--    zero reads, four current members.
select _test_act_as(current_setting('test.coach')::uuid);
select results_eq(
  $$select read_count, member_count
      from public.announcement_read_stats(current_setting('test.ann')::uuid)$$,
  $$select 0::integer as read_count, 4::integer as member_count$$,
  'coach sees 0 of 4 before anyone reads'
);

-- 2. A read by a current member is counted. Each member records their
--    own read — announcement_reads is self-insert under RLS, which is
--    also the honest path (the one the app takes).
select _test_act_as(current_setting('test.member')::uuid);
insert into public.announcement_reads (announcement_id, profile_id)
values (current_setting('test.ann')::uuid, current_setting('test.member')::uuid);
select _test_act_as(current_setting('test.leaver')::uuid);
insert into public.announcement_reads (announcement_id, profile_id)
values (current_setting('test.ann')::uuid, current_setting('test.leaver')::uuid);
select _test_act_as(current_setting('test.coach')::uuid);
select results_eq(
  $$select read_count, member_count
      from public.announcement_read_stats(current_setting('test.ann')::uuid)$$,
  $$select 2::integer as read_count, 4::integer as member_count$$,
  'two reads by current members count'
);

-- 3. A member who leaves drops out of BOTH numbers: their old read says
--    nothing about reach, and leavers in the denominator would make
--    every old announcement look ignored. The leave goes through the
--    real RPC (a bare UPDATE would be silently filtered by RLS).
select _test_act_as(current_setting('test.leaver')::uuid);
select lives_ok(
  $$select public.leave_gym(current_setting('test.gym')::uuid,
                            current_setting('test.leaver')::uuid)$$,
  'the leaver leaves through the real path'
);
select _test_act_as(current_setting('test.coach')::uuid);
select results_eq(
  $$select read_count, member_count
      from public.announcement_read_stats(current_setting('test.ann')::uuid)$$,
  $$select 1::integer as read_count, 3::integer as member_count$$,
  'a departed member is outside both counts'
);

-- 4. A plain member is refused by the function itself.
select _test_act_as(current_setting('test.member')::uuid);
select throws_ok(
  $$select * from public.announcement_read_stats(current_setting('test.ann')::uuid)$$,
  'Not allowed',
  'a plain member cannot read the reach numbers'
);

-- 5. A non-member is refused the same way.
select _test_act_as(current_setting('test.out')::uuid);
select throws_ok(
  $$select * from public.announcement_read_stats(current_setting('test.ann')::uuid)$$,
  'Not allowed',
  'an outsider cannot read the reach numbers'
);

-- 6. An unknown announcement raises rather than returning empty.
select _test_act_as(current_setting('test.coach')::uuid);
select throws_ok(
  $$select * from public.announcement_read_stats('00000000-0000-4000-8000-000000000000'::uuid)$$,
  'Announcement not found',
  'an unknown announcement id raises'
);

-- 7. anon holds no execute grant at all.
select ok(
  not has_function_privilege('anon', 'public.announcement_read_stats(uuid)', 'execute'),
  'anon cannot execute announcement_read_stats'
);

select * from finish();
rollback;
