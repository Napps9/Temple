-- One active Temple plan per name per gym (0131). Case-insensitive and
-- whitespace-trimmed, so "Gold", "gold" and " Gold " collide. Archived
-- plans don't reserve the name.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@pnu.test');
  v_gym   uuid := _test_mk_gym('PNU Gym', 'pnu-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym', v_gym::text, true);
end $$;

-- 1. First plan with a name inserts fine.
insert into public.membership_plans (gym_id, name, kind)
  values (current_setting('test.gym')::uuid, 'Gold', 'unlimited');
select pass('first plan with a name inserts');

-- 2. Same name, different case is rejected.
select throws_ok(
  $$insert into public.membership_plans (gym_id, name, kind)
      values (current_setting('test.gym')::uuid, 'gold', 'unlimited')$$,
  '23505',
  null,
  'a second active plan with the same name (different case) is rejected'
);

-- 3. Same name with surrounding whitespace is rejected.
select throws_ok(
  $$insert into public.membership_plans (gym_id, name, kind)
      values (current_setting('test.gym')::uuid, '  Gold  ', 'unlimited')$$,
  '23505',
  null,
  'a second active plan with the same trimmed name is rejected'
);

-- 4. A distinct name inserts fine.
insert into public.membership_plans (gym_id, name, kind)
  values (current_setting('test.gym')::uuid, 'Silver', 'unlimited');
select pass('a distinct plan name inserts');

-- 5. Archiving frees the name for reuse.
update public.membership_plans set archived_at = now()
  where gym_id = current_setting('test.gym')::uuid
    and lower(btrim(name)) = 'gold';
insert into public.membership_plans (gym_id, name, kind)
  values (current_setting('test.gym')::uuid, 'Gold', 'unlimited');
select pass('the name is free again once the old plan is archived');

select * from finish();
rollback;
