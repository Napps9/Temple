-- set_announcement_pin (0261): the only writer of a pin, now that the
-- pin has a window. Same gate as posting; the window is bounded; and
-- 0195's revoke stays in force — the RPC must not have handed UPDATE
-- back to the client on its way past.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@pinwindow.test');
  v_coach  uuid := _test_mk_user('coach@pinwindow.test');
  v_member uuid := _test_mk_user('member@pinwindow.test');
  v_out    uuid := _test_mk_user('outsider@pinwindow.test');
  v_gym    uuid := _test_mk_gym('Pin Window Gym', 'pin-window-gym');
  v_other  uuid := _test_mk_gym('Other Pin Gym', 'other-pin-gym');
  v_ann    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_other, v_out, 'owner');

  insert into public.gym_announcements (gym_id, posted_by, title, body, pinned)
  values (v_gym, v_owner, 'Closed Monday', 'Cleaning the floor.', false)
  returning id into v_ann;

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.ann',    v_ann::text,    false);
  perform set_config('test.coach',  v_coach::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.out',    v_out::text,    false);
end $$;

-- 1. A capability holder pins with a window.
select _test_act_as(current_setting('test.coach')::uuid);
select lives_ok(
  $$select public.set_announcement_pin(
      current_setting('test.ann')::uuid, true, now(), now() + interval '7 days')$$,
  'a coach can pin a notice for a week'
);

-- 2. The window landed on the row.
select ok(
  (select pinned and pinned_until is not null
     from public.gym_announcements
    where id = current_setting('test.ann')::uuid),
  'the pin and its end date are stored'
);

-- 3. Unpinning clears the window rather than leaving a stale one
--    behind — a re-pin later must not inherit last month's end date.
select lives_ok(
  $$select public.set_announcement_pin(current_setting('test.ann')::uuid, false)$$,
  'a coach can unpin'
);
select ok(
  (select not pinned and pinned_from is null and pinned_until is null
     from public.gym_announcements
    where id = current_setting('test.ann')::uuid),
  'unpinning clears the window'
);

-- 4. A pin measured in years is the failure mode this migration exists
--    to stop.
select throws_ok(
  $$select public.set_announcement_pin(
      current_setting('test.ann')::uuid, true, now(), now() + interval '400 days')$$,
  'Pin window out of range',
  'a pin longer than a year is refused'
);

-- 5. An end before its start is refused.
select throws_ok(
  $$select public.set_announcement_pin(
      current_setting('test.ann')::uuid, true,
      now() + interval '3 days', now() + interval '1 day')$$,
  'Pin window out of range',
  'a window that ends before it starts is refused'
);

-- 6. A plain member is refused by the function, not merely hidden from
--    in the client.
select _test_act_as(current_setting('test.member')::uuid);
select throws_ok(
  $$select public.set_announcement_pin(current_setting('test.ann')::uuid, true)$$,
  'Not allowed',
  'a plain member cannot pin'
);

-- 7. Another gym's owner is refused. The definer resolves the row
--    before the gate, so the answer is 'Not allowed' rather than 'not
--    found' — the same shape announcement_read_stats (0253) gives, and
--    the capability check is what actually holds the door.
select _test_act_as(current_setting('test.out')::uuid);
select throws_ok(
  $$select public.set_announcement_pin(current_setting('test.ann')::uuid, true)$$,
  'Not allowed',
  'another gym cannot pin this gym''s notice'
);

-- 8. An unknown id raises rather than silently succeeding.
select _test_act_as(current_setting('test.coach')::uuid);
select throws_ok(
  $$select public.set_announcement_pin(
      '00000000-0000-0000-0000-000000000000'::uuid, true)$$,
  'Announcement not found',
  'an unknown announcement raises'
);

-- 9. 0195's revoke still holds: the RPC is the only way in.
select ok(
  not has_table_privilege('authenticated', 'public.gym_announcements', 'update'),
  'authenticated still cannot UPDATE gym_announcements directly'
);

-- 10. anon holds no execute grant on the new function.
select ok(
  not has_function_privilege(
    'anon',
    'public.set_announcement_pin(uuid,boolean,timestamptz,timestamptz)',
    'execute'),
  'anon cannot execute set_announcement_pin'
);

select * from finish();
rollback;
