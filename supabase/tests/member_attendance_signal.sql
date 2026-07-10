-- Retention cockpit (0119): v_member_attendance_signal derives each member's
-- recent cadence vs their own baseline. A member drifting below their normal
-- shows a cadence_ratio < 1; a member with no baseline history reads NULL
-- ("no signal", never "decayed"); a member who never attended has no row.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@att.test');
  v_coach   uuid := _test_mk_user('coach@att.test');
  v_decay   uuid := _test_mk_user('decay@att.test');
  v_new     uuid := _test_mk_user('new@att.test');
  v_never   uuid := _test_mk_user('never@att.test');
  v_gym     uuid := _test_mk_gym('Att Gym', 'att-gym');
  v_ct      uuid;
  v_s       uuid;
  v_days    int;
  -- One recent visit vs a fuller baseline => a genuine drop (cadence 0.5).
  -- Baseline days are all > 28 so they never double-count in bookings_28d.
  v_recent  int[] := array[2];                     -- < 14d: recent only
  v_base    int[] := array[30, 40, 50, 60, 70];    -- 30..70d: baseline only
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_decay, 'member');
  perform _test_mk_membership(v_gym, v_new,   'member');
  perform _test_mk_membership(v_gym, v_never, 'member');

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'WOD', '#2563EB') returning id into v_ct;

  -- Decaying member: 2 attended in the last fortnight, 5 in the baseline
  -- window. baseline_weekly = 5/10 = 0.5; cadence = (2/4)/0.5 = 1.0.
  foreach v_days in array (v_recent || v_base) loop
    v_s := _test_mk_session(v_gym, v_coach, now() - make_interval(days => v_days), 60, v_ct);
    perform _test_mk_booking(v_s, v_decay);
    -- attended_at requires marked_by (class_bookings_marked_by_required).
    update public.class_bookings
      set attended_at = now() - make_interval(days => v_days), marked_by = v_coach
      where class_session_id = v_s and profile_id = v_decay;
  end loop;

  -- New member: a single recent visit, no baseline history.
  v_s := _test_mk_session(v_gym, v_coach, now() - interval '1 day', 60, v_ct);
  perform _test_mk_booking(v_s, v_new);
  update public.class_bookings
    set attended_at = now() - interval '1 day', marked_by = v_coach
    where class_session_id = v_s and profile_id = v_new;

  -- Never-attended member: a booking with no check-in.
  v_s := _test_mk_session(v_gym, v_coach, now() - interval '5 days', 60, v_ct);
  perform _test_mk_booking(v_s, v_never);

  perform _test_act_as(v_owner);
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.decay', v_decay::text, true);
  perform set_config('test.new',   v_new::text,   true);
  perform set_config('test.never', v_never::text, true);
end $$;

-- 1-3. The decaying member's derived cadence.
select is(
  (select bookings_28d::int from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.decay')::uuid),
  1,
  'decaying member: 1 attended session in the last 28 days');
select is(
  (select baseline_weekly from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.decay')::uuid),
  0.5::numeric,
  'decaying member: baseline of 0.5 sessions/week');
select is(
  (select cadence_ratio from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.decay')::uuid),
  0.5::numeric,
  'decaying member: cadence of 0.5 vs their baseline (a real drop)');

-- 4-5. A member with no baseline history reads NULL cadence, not zero.
select ok(
  (select cadence_ratio is null from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.new')::uuid),
  'new member: no baseline => NULL cadence (no signal, not decayed)');
select is(
  (select bookings_28d::int from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.new')::uuid),
  1,
  'new member: their single recent visit is still counted');

-- 6. A member who never checked in has no row at all.
select is(
  (select count(*)::int from public.v_member_attendance_signal
   where gym_id = current_setting('test.gym')::uuid
     and profile_id = current_setting('test.never')::uuid),
  0,
  'never-attended member has no attendance-signal row');

select * from finish();
rollback;
