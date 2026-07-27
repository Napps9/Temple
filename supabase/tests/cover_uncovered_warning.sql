-- Invariant: warn_uncovered_cover chases the failure case — a cover
-- request nobody answered, with the class close at hand.
--
-- Three things it must get right: only imminent unclaimed classes count,
-- the warning is a digest per request rather than one per class, and it
-- repeats daily (the idempotency key carries the gym-local date) while
-- a same-day re-run stays a no-op.
--
-- Assertions run as the owner: cover_notifications is RLS'd to your own
-- rows plus an admin's view of the gym.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@covwarn.test');
  v_admin   uuid := _test_mk_user('admin@covwarn.test');
  v_coach_a uuid := _test_mk_user('coach_a@covwarn.test');  -- requester
  v_coach_b uuid := _test_mk_user('coach_b@covwarn.test');  -- could claim
  v_gym     uuid := _test_mk_gym('Warn Gym', 'covwarn');
  v_ct      uuid;
  v_soon_1  uuid;
  v_soon_2  uuid;
  v_later   uuid;
  v_claimed uuid;
  v_req_soon  uuid;
  v_req_later uuid;
  v_offer   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,   'owner');
  perform _test_mk_membership(v_gym, v_admin,   'admin');
  perform _test_mk_membership(v_gym, v_coach_a, 'coach');
  perform _test_mk_membership(v_gym, v_coach_b, 'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Warn Test', '#F97316')
    returning id into v_ct;

  -- Two classes inside the 48h lead, one well outside it, one that will
  -- be claimed. All four on the same request so the digest rule bites.
  v_soon_1  := _test_mk_session(v_gym, v_coach_a, now() + interval '6 hours',  60, v_ct);
  v_soon_2  := _test_mk_session(v_gym, v_coach_a, now() + interval '30 hours', 60, v_ct);
  v_claimed := _test_mk_session(v_gym, v_coach_a, now() + interval '10 hours', 60, v_ct);
  v_later   := _test_mk_session(v_gym, v_coach_a, now() + interval '10 days',  60, v_ct);

  perform _test_act_as(v_coach_a);
  v_req_soon := request_cover(
    array[v_soon_1, v_soon_2, v_claimed], null::text);
  v_req_later := request_cover(array[v_later], null::text);

  select id into v_offer from public.cover_request_sessions
    where request_id = v_req_soon and class_session_id = v_claimed;

  perform _test_act_as(v_coach_b);
  perform claim_cover(v_offer);

  -- warn_uncovered_cover is revoked from authenticated — it is a cron
  -- sweep, not a user action — and _test_act_as left us as that role.
  -- Restore the session role the same way _test_act_as set it.
  perform set_config('role', 'postgres', true);
  perform warn_uncovered_cover();

  perform set_config('test.req_soon',  v_req_soon::text,  true);
  perform set_config('test.req_later', v_req_later::text, true);
  perform set_config('test.gym',       v_gym::text,       true);
  perform set_config('test.owner',     v_owner::text,     true);
  perform set_config('test.admin',     v_admin::text,     true);
  perform set_config('test.coach_a',   v_coach_a::text,   true);
  perform set_config('test.coach_b',   v_coach_b::text,   true);

  perform _test_act_as(v_owner);
end;
$$;

-- 1. Two imminent unclaimed classes on one request = ONE warning per
--    recipient per channel, not one per class.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.req_soon')::uuid
       and kind = 'cover_uncovered'
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.coach_a')::uuid),
  1,
  'the requester gets one digest warning, not one per uncovered class'
);

-- 2. The requester is warned — it is their cover that is failing.
select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.req_soon')::uuid
       and kind = 'cover_uncovered'
       and channel = 'in_app'
       and recipient_profile_id = current_setting('test.coach_a')::uuid),
  'sent',
  'the requester is warned in-app immediately'
);

-- 3. Owners and admins run the gym, so they are warned too.
select is(
  (select count(distinct recipient_profile_id)::int
     from public.cover_notifications
     where request_id = current_setting('test.req_soon')::uuid
       and kind = 'cover_uncovered'
       and channel = 'in_app'
       and recipient_profile_id in (
         current_setting('test.owner')::uuid,
         current_setting('test.admin')::uuid
       )),
  2,
  'the owner and the admin are both warned'
);

-- 4. Other coaches are not re-pinged; they had the request digest.
select is(
  (select count(*)::int from public.cover_notifications
     where kind = 'cover_uncovered'
       and recipient_profile_id = current_setting('test.coach_b')::uuid),
  0,
  'a coach who could claim is not nagged again by the sweep'
);

-- 5. A request whose classes are all far off is left alone.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.req_later')::uuid
       and kind = 'cover_uncovered'),
  0,
  'a request with no imminent class is not warned about'
);

-- 6. Email is queued for the worker, same as the other kinds.
select is(
  (select status from public.cover_notifications
     where request_id = current_setting('test.req_soon')::uuid
       and kind = 'cover_uncovered'
       and channel = 'email'
       and recipient_profile_id = current_setting('test.coach_a')::uuid),
  'queued',
  'the warning email is queued for the edge worker'
);

-- 7. Re-running the same day is a no-op — the idempotency key holds.
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before from public.cover_notifications
    where kind = 'cover_uncovered';
  perform set_config('role', 'postgres', true);
  perform warn_uncovered_cover();
  select count(*) into v_after from public.cover_notifications
    where kind = 'cover_uncovered';
  perform set_config('test.before', v_before::text, true);
  perform set_config('test.after',  v_after::text,  true);
end;
$$;

select is(
  current_setting('test.after'),
  current_setting('test.before'),
  'a second sweep on the same day adds nothing'
);

-- 8. But the key carries the gym-local date, so tomorrow warns again.
select ok(
  (select bool_and(idempotency_key like '%:' || (now() at time zone 'UTC')::date::text)
     from public.cover_notifications
     where kind = 'cover_uncovered'),
  'the idempotency key is day-scoped, so the warning repeats daily'
);

-- 9-11. The lead time is gyms.cover_warning_hours (0167), not a
--       constant. A gym on a week's notice catches the far-off request
--       the 48h default ignored; a gym set to 0 is opted out entirely.
do $$
declare
  v_week_gym  uuid := _test_mk_gym('Week Gym', 'covwarn-week');
  v_off_gym   uuid := _test_mk_gym('Off Gym',  'covwarn-off');
  v_week_coach uuid := _test_mk_user('coach@covwarn-week.test');
  v_off_coach  uuid := _test_mk_user('coach@covwarn-off.test');
  v_week_owner uuid := _test_mk_user('owner@covwarn-week.test');
  v_off_owner  uuid := _test_mk_user('owner@covwarn-off.test');
  v_week_req  uuid;
  v_off_req   uuid;
  v_s1 uuid;
  v_s2 uuid;
begin
  perform _test_mk_membership(v_week_gym, v_week_owner, 'owner');
  perform _test_mk_membership(v_week_gym, v_week_coach, 'coach');
  perform _test_mk_membership(v_off_gym,  v_off_owner,  'owner');
  perform _test_mk_membership(v_off_gym,  v_off_coach,  'coach');

  update public.gyms set cover_warning_hours = 168 where id = v_week_gym;
  update public.gyms set cover_warning_hours = 0   where id = v_off_gym;

  -- Four days out: outside the 48h default, inside a week's notice.
  v_s1 := _test_mk_session(v_week_gym, v_week_coach, now() + interval '4 days');
  v_s2 := _test_mk_session(v_off_gym,  v_off_coach,  now() + interval '4 hours');

  perform _test_act_as(v_week_coach);
  v_week_req := request_cover(array[v_s1], null::text);
  perform _test_act_as(v_off_coach);
  v_off_req := request_cover(array[v_s2], null::text);

  perform set_config('role', 'postgres', true);
  perform warn_uncovered_cover();

  perform set_config('test.week_req', v_week_req::text, true);
  perform set_config('test.off_req',  v_off_req::text,  true);
end;
$$;

select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.week_req')::uuid
       and kind = 'cover_uncovered'
       and channel = 'in_app'),
  2,
  'a gym on a 168-hour lead is warned about a class four days out'
);

select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.off_req')::uuid
       and kind = 'cover_uncovered'),
  0,
  'a gym with cover_warning_hours = 0 is opted out of the sweep'
);

-- The original gym is on the 48h default, so its far-off request is
-- still ignored — the per-gym lead did not become a global one.
select is(
  (select count(*)::int from public.cover_notifications
     where request_id = current_setting('test.req_later')::uuid
       and kind = 'cover_uncovered'),
  0,
  'the lead is per gym — a default-48h gym still ignores a distant class'
);

select * from finish();
rollback;
