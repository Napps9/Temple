-- Invariant: a member's answer to "which lift do you mean by 'clean'?"
-- is private to them, survives leaving a gym, and a second answer
-- replaces the first rather than duplicating it.
--
-- Mirrors tracked_movement_favourites (0091): profile-scoped, no
-- gym_id, self-only RLS.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@movpref.test');
  v_a     uuid := _test_mk_user('a@movpref.test');
  v_b     uuid := _test_mk_user('b@movpref.test');
  v_gym   uuid := _test_mk_gym('Pref Gym', 'movpref');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);
  perform set_config('test.gym', v_gym::text, true);

  perform _test_act_as(v_a);
  insert into public.member_movement_preferences (profile_id, term, movement_key)
    values (v_a, 'clean', 'power_clean');
end;
$$;

-- 1. Own row reads back.
select is(
  (select movement_key from public.member_movement_preferences
     where profile_id = current_setting('test.a')::uuid and term = 'clean'),
  'power_clean',
  'a member can read their own answer'
);

-- 2. Changing your mind replaces rather than duplicates.
do $$
begin
  insert into public.member_movement_preferences (profile_id, term, movement_key)
    values (current_setting('test.a')::uuid, 'clean', 'squat_clean')
  on conflict (profile_id, term)
    do update set movement_key = excluded.movement_key, updated_at = now();
end;
$$;

select is(
  (select count(*)::int from public.member_movement_preferences
     where profile_id = current_setting('test.a')::uuid and term = 'clean'),
  1,
  'a second answer for the same term upserts, it does not duplicate'
);

select is(
  (select movement_key from public.member_movement_preferences
     where profile_id = current_setting('test.a')::uuid and term = 'clean'),
  'squat_clean',
  'the newer answer wins'
);

-- 3. The CHECK keeps the key normalised, so lookups can't miss.
select throws_ok(
  format(
    'insert into public.member_movement_preferences (profile_id, term, movement_key) values (%L::uuid, %L, %L)',
    current_setting('test.a'), ' Clean ', 'power_clean'
  ),
  null::text,
  null::text,
  'an un-normalised term is rejected at the database'
);

-- 4. RLS: another member sees nothing of it.
do $$ begin perform _test_act_as(current_setting('test.b')::uuid); end $$;

select is(
  (select count(*)::int from public.member_movement_preferences),
  0,
  'a member cannot read another member''s answers'
);

-- 5. The answer is not gym data — it survives leaving the gym, the way
--    the rest of a member's tracking history does.
do $$
begin
  perform set_config('role', 'postgres', true);
  update public.gym_memberships
    set left_at = now()
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.a')::uuid;
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*)::int from public.member_movement_preferences
     where profile_id = current_setting('test.a')::uuid),
  1,
  'the answer survives the member leaving the gym'
);

select * from finish();
rollback;
