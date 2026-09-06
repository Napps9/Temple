-- 0280: a class type or a plan leaves only through delete_class_type or
-- delete_plan (0245), which check can_hard_delete and refuse rows with
-- dependents. The row-level delete policies that let a manager bypass
-- both are gone, and so is the grant beneath them, because a policy can
-- be re-added by accident and a grant cannot be used by nobody.

begin;
select plan(9);

\ir _helpers.psql

select ok(
  not has_table_privilege('authenticated', 'public.class_types', 'delete'),
  'authenticated cannot DELETE class_types directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.membership_plans', 'delete'),
  'authenticated cannot DELETE membership_plans directly'
);

select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.class_types'::regclass and polcmd = 'd'),
  0,
  'and class_types has no delete policy left to lean on'
);

select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.membership_plans'::regclass and polcmd = 'd'),
  0,
  'nor does membership_plans'
);

-- The intended path keeps working, or the revoke has broken a feature
-- rather than closed a hole.
do $$
declare
  v_owner uuid := _test_mk_user('door-owner@example.com');
  v_coach uuid := _test_mk_user('door-coach@example.com');
  v_gym   uuid := _test_mk_gym('Door Gym', 'door-gym');
  v_gone  uuid;
  v_stays uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Yoga', '#112233') returning id into v_gone;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'Pilates', '#445566') returning id into v_stays;
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.stays', v_stays::text, true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ select public.delete_class_type(current_setting('test.gone')::uuid) $$,
  'the owner deletes a class type with no dependents through the RPC'
);

select is(
  (select count(*)::int from public.class_types
    where id = current_setting('test.gone')::uuid),
  0,
  'and it is gone'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.delete_class_type(current_setting('test.stays')::uuid) $$,
  'Not authorised',
  'a coach without can_hard_delete is refused by the RPC'
);

select throws_ok(
  $$ delete from public.class_types where id = current_setting('test.stays')::uuid $$,
  'permission denied for table class_types',
  'and cannot go round it with a plain DELETE on class_types'
);

select throws_ok(
  $$ delete from public.membership_plans where gym_id = 'a0000000-0000-0000-0000-000000000000'::uuid $$,
  'permission denied for table membership_plans',
  'or on membership_plans'
);

select * from finish();
rollback;
