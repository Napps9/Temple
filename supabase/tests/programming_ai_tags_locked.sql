-- programming_ai_tags is a service-role-only cache: the AI tags feed
-- the Analysis page only through the classify-programming edge
-- function, which re-authorises callers itself. If a client policy
-- ever appears here, any member could enumerate a gym's cached
-- programming reads through PostgREST — this file pins the lockdown.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid;
  v_gym uuid;
begin
  v_owner := _test_mk_user('owner@aiptags.test');
  v_gym := _test_mk_gym('AI Tags Gym', 'aiptags');
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.programming_ai_tags
    (gym_id, content_hash, movement_keys, duration_minutes, load_level, confidence, model)
  values
    (v_gym, 'deadbeef', '{back_squat}', 12, 'heavy', 'high', 'test-model');
  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.owner', v_owner::text, true);
end $$;

-- 1. The service path (no JWT) sees the seeded row.
select is(
  (select count(*)::int from public.programming_ai_tags),
  1,
  'service role sees the cached tag'
);

-- 2. The load-level vocabulary is pinned by the CHECK constraint.
select throws_like(
  format(
    $$ insert into public.programming_ai_tags
         (gym_id, content_hash, movement_keys, confidence, model, load_level)
       values (%L::uuid, 'cafebabe', '{}', 'low', 'test-model', 'crushing') $$,
    current_setting('test.gym')
  ),
  '%violates check constraint%',
  'an out-of-vocabulary load level is rejected'
);

-- 3. Even the gym owner reads nothing through PostgREST.
select _test_act_as(current_setting('test.owner')::uuid);
select is(
  (select count(*)::int from public.programming_ai_tags),
  0,
  'the gym owner sees no rows directly'
);

-- 4. And cannot write tags directly either.
select throws_like(
  format(
    $$ insert into public.programming_ai_tags
         (gym_id, content_hash, movement_keys, confidence, model)
       values (%L::uuid, 'feedface', '{}', 'low', 'sneaky') $$,
    current_setting('test.gym')
  ),
  '%row-level security%',
  'clients cannot insert tags directly'
);

select * from finish();
rollback;
