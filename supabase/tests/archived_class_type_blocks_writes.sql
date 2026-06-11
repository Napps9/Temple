-- Archiving a class type stops the production line: book_class refuses,
-- extend_recurrence no-ops, class_programming inserts/updates raise.
-- Existing future sessions are not auto-cancelled (the v1 "wind down"
-- model — coach cancels individually if they want refunds).

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@arch.test');
  v_member   uuid := _test_mk_user('m@arch.test');
  v_gym      uuid := _test_mk_gym('Arch Gym', 'arch-gym');
  v_ct       uuid;
  v_session  uuid;
  v_rec      uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Give the member an unlimited plan so book_class wouldn't otherwise
  -- bounce on eligibility. is_booking_eligible runs inside book_class.
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlim', 'unlimited')
    returning plan_id into v_rec;  -- reusing v_rec as a scratch
  insert into public.plan_subscriptions (
    gym_membership_id, profile_id, gym_id, plan_id, status
  )
  select gm.id, v_member, v_gym, v_rec, 'active'::public.plan_sub_state
  from public.gym_memberships gm
  where gm.gym_id = v_gym and gm.profile_id = v_member;

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#10B981')
    returning id into v_ct;

  -- Future session for that class type, tomorrow.
  v_session := _test_mk_session(v_gym, v_owner, now() + interval '1 day', 60, v_ct);

  -- Recurrence so we can probe extend_recurrence.
  insert into public.class_recurrences
    (gym_id, class_type_id, days_of_week, times, duration_minutes,
     capacity, starts_on, tz, created_by)
  values
    (v_gym, v_ct, array[1,3,5], array['09:00'], 60, 12,
     current_date, 'UTC', v_owner)
  returning id into v_rec;

  -- Owner archives the class type.
  perform _test_act_as(v_owner);
  perform public.archive_class_type(v_ct);

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.member',  v_member::text,  true);
  perform set_config('test.ct',      v_ct::text,      true);
  perform set_config('test.session', v_session::text, true);
  perform set_config('test.rec',     v_rec::text,     true);
end;
$$;

-- 1. Member cannot book a new slot into the archived class type.
select throws_like(
  $$ select public.book_class((select current_setting('test.session'))::uuid) $$,
  '%no longer running%',
  'book_class refuses sessions of an archived class type'
);

-- 2. Coach cannot insert programming for the archived class type.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
end;
$$;

select throws_like(
  $$
    insert into public.class_programming
      (gym_id, class_type_id, date, sections, author_id)
    values
      (
        (select current_setting('test.gym'))::uuid,
        (select current_setting('test.ct'))::uuid,
        current_date,
        '[]'::jsonb,
        (select current_setting('test.owner'))::uuid
      )
  $$,
  '%archived class type%',
  'class_programming trigger blocks inserts for an archived class type'
);

-- 3. extend_recurrence is a no-op (returns without creating sessions
--    and without raising).
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before from public.class_sessions
    where class_type_id = current_setting('test.ct')::uuid;
  perform public.extend_recurrence(
    current_setting('test.rec')::uuid,
    (current_date + 14)::date
  );
  select count(*) into v_after from public.class_sessions
    where class_type_id = current_setting('test.ct')::uuid;
  perform set_config('test.before', v_before::text, true);
  perform set_config('test.after',  v_after::text,  true);
end;
$$;

select is(
  current_setting('test.before')::int,
  current_setting('test.after')::int,
  'extend_recurrence is a no-op when the class type is archived'
);

-- 4. After restore: extend_recurrence works again.
do $$
begin
  perform public.restore_class_type(current_setting('test.ct')::uuid);
  perform public.extend_recurrence(
    current_setting('test.rec')::uuid,
    (current_date + 14)::date
  );
end;
$$;

select cmp_ok(
  (select count(*) from public.class_sessions
     where class_type_id = current_setting('test.ct')::uuid),
  '>',
  current_setting('test.after')::int,
  'extend_recurrence creates new sessions after the class type is restored'
);

-- 5. After restore: programming inserts succeed.
do $$
begin
  insert into public.class_programming
    (gym_id, class_type_id, date, sections, author_id)
  values
    (
      current_setting('test.gym')::uuid,
      current_setting('test.ct')::uuid,
      current_date,
      '[]'::jsonb,
      current_setting('test.owner')::uuid
    )
  on conflict (class_type_id, date) do nothing;
end;
$$;

select is(
  (select count(*) from public.class_programming
     where class_type_id = current_setting('test.ct')::uuid
       and date = current_date)::int,
  1,
  'class_programming insert succeeds after restore'
);

select * from finish();
rollback;
